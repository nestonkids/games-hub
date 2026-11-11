// NESTON Games Hub API - 管理側(admin)
// ゲームの編集・コメント承認。このWorker自体をCloudflare Access(Zero Trust)で保護しており、
// @nestonkids.com のメールでログインした人しかそもそも到達できない前提のため、
// Worker側にはパスワード認証を持たない。

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(request, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
      console.error(e);
      return json({ error: 'サーバーでエラーが起きました' }, 500, cors);
    }
  },
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- ルーティング ----------
async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/'); // ['api', 'admin', ...]
  const m = request.method;
  if (parts[0] !== 'api' || parts[1] !== 'admin') throw new HttpError(404, 'not found');

  if (parts[2] === 'games') {
    if (parts.length === 3 && m === 'GET') return adminListGames(env);
    if (parts.length === 3 && m === 'POST') return adminSaveGame(request, env, null);
    if (parts.length === 4 && m === 'PUT') return adminSaveGame(request, env, parts[3]);
    if (parts.length === 4 && m === 'DELETE') return adminDeleteGame(env, parts[3]);
  }
  if (parts[2] === 'scratch' && parts.length === 4 && m === 'GET') return adminScratchInfo(parts[3]);
  if (parts[2] === 'game-json' && parts.length === 3 && m === 'GET') return adminGameJsonInfo(url.searchParams.get('url'));
  if (parts[2] === 'comments') {
    if (parts.length === 3 && m === 'GET') return adminListComments(env, url.searchParams.get('status'), url.searchParams.get('game_id'));
    if (parts.length === 5 && parts[4] === 'approve' && m === 'POST') return adminApprove(env, parts[3]);
    if (parts.length === 5 && parts[4] === 'unapprove' && m === 'POST') return adminUnapprove(env, parts[3]);
    if (parts.length === 4 && m === 'DELETE') return adminDeleteComment(env, parts[3]);
  }
  throw new HttpError(404, 'not found');
}

// ---------- ゲーム ----------
async function adminListGames(env) {
  const { results } = await env.DB.prepare(
    `SELECT g.* FROM games g ORDER BY g.created_at DESC`
  ).all();
  return json({ games: results.map((r) => ({ ...toGame(r), visible: !!r.visible })) });
}

async function adminSaveGame(request, env, existingId) {
  const body = await readJson(request);
  const g = validateGame(body, existingId);
  if (existingId) {
    const r = await env.DB.prepare(
      `UPDATE games SET title=?, author=?, description=?, thumbnail=?, type=?, scratch_id=?, url=?, visible=? WHERE id=?`
    ).bind(g.title, g.author, g.description, g.thumbnail, g.type, g.scratchId, g.url, g.visible, existingId).run();
    if (r.meta.changes === 0) throw new HttpError(404, 'ゲームが見つかりません');
    return json({ ok: true });
  }
  const dup = await env.DB.prepare('SELECT 1 FROM games WHERE id = ?').bind(g.id).first();
  if (dup) throw new HttpError(409, 'このIDはすでに使われています');
  await env.DB.prepare(
    `INSERT INTO games (id, title, author, description, thumbnail, type, scratch_id, url, visible, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(g.id, g.title, g.author, g.description, g.thumbnail, g.type, g.scratchId, g.url, g.visible, now()).run();
  return json({ ok: true }, 201);
}

async function adminDeleteGame(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comments WHERE game_id = ?').bind(id),
    env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

// Scratch作品IDから情報を取得する(ブラウザから直接Scratch APIを叩くとCORSで弾かれるため、このWorker経由で中継する)
async function adminScratchInfo(id) {
  if (!/^\d{1,15}$/.test(id)) throw new HttpError(400, 'Scratch作品IDは数字で入れてください');
  const res = await fetch(`https://api.scratch.mit.edu/projects/${id}`);
  if (res.status === 404) throw new HttpError(404, 'Scratchでこの作品IDが見つかりません(非公開の可能性があります)');
  if (!res.ok) throw new HttpError(502, 'Scratchから情報を取得できませんでした');
  const data = await res.json();
  // Scratchの「使い方」欄を優先し、無ければ「説明(Notes and Credits)」欄を使う
  const instructions = String(data.instructions || '').trim();
  return json({
    title: clean(data.title, 60),
    author: clean(data.author && data.author.username, 40),
    description: cleanMultiline(instructions || data.description, 300),
    thumbnail: `https://cdn2.scratch.mit.edu/get_image/project/${id}_480x360.png`,
  });
}

// 生徒が公開したゲームのURL直下にある game.json を取得し、タイトル・作者・サムネイルを自動入力する
// (sample-web-game/AGENTS.md で定めている game.json の形式: { title, author, thumbnail })
async function adminGameJsonInfo(rawUrl) {
  const gameJsonUrl = buildGameJsonUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let res;
  try {
    res = await fetch(gameJsonUrl, { signal: controller.signal });
  } catch {
    throw new HttpError(502, 'game.jsonの取得中にエラーが起きました(URLが正しいか確認してください)');
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 404) throw new HttpError(404, 'game.jsonが見つかりません(ゲームのURL直下に置かれているか確認してください)');
  if (!res.ok) throw new HttpError(502, 'game.jsonを取得できませんでした');
  const text = await res.text();
  if (text.length > 50000) throw new HttpError(413, 'game.jsonが大きすぎます');
  let data;
  try { data = JSON.parse(text); } catch { throw new HttpError(400, 'game.jsonの内容がJSONとして読み取れません'); }
  let thumbnail = '';
  if (data.thumbnail) {
    try { thumbnail = new URL(String(data.thumbnail), gameJsonUrl).toString(); } catch { /* 不正なら空のまま */ }
  }
  return json({
    title: clean(data.title, 60),
    author: clean(data.author, 40),
    thumbnail: /^https:\/\//.test(thumbnail) ? thumbnail : '',
  });
}

// ゲームのURLから game.json の場所を組み立てる。
// 末尾がファイル名(index.html など)でなければディレクトリとみなして "/" を補う。
function buildGameJsonUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (!/^https:\/\/\S{1,500}$/.test(raw)) throw new HttpError(400, 'ゲームのURLは https:// から始めてください');
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'ゲームのURLが正しくありません'); }
  const segments = u.pathname.split('/');
  const last = segments[segments.length - 1];
  if (!(last && last.includes('.')) && !u.pathname.endsWith('/')) u.pathname += '/';
  return new URL('game.json', u).toString();
}

// ---------- コメント ----------
// status を指定すればその状態だけ、game_id を指定すればそのゲームのコメントだけに絞れる(両方略すと承認待ちのみ)
async function adminListComments(env, status, gameId) {
  const conditions = [];
  const params = [];
  if (status === 'approved' || status === 'pending') {
    conditions.push('c.status = ?'); params.push(status);
  } else if (!gameId) {
    conditions.push("c.status = 'pending'"); // 既定値(従来どおり)
  }
  if (gameId) { conditions.push('c.game_id = ?'); params.push(gameId); }
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.game_id, c.nickname, c.body, c.status, c.created_at, g.title AS game_title
     FROM comments c LEFT JOIN games g ON g.id = c.game_id
     WHERE ${conditions.join(' AND ')} ORDER BY c.id DESC LIMIT 200`
  ).bind(...params).all();
  return json({ comments: results });
}
async function adminApprove(env, id) {
  const r = await env.DB.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").bind(Number(id)).run();
  if (r.meta.changes === 0) throw new HttpError(404, 'コメントが見つかりません');
  return json({ ok: true });
}
// 公開中のコメントを承認待ちに戻す(非公開にする。削除はしない)
async function adminUnapprove(env, id) {
  const r = await env.DB.prepare("UPDATE comments SET status = 'pending' WHERE id = ?").bind(Number(id)).run();
  if (r.meta.changes === 0) throw new HttpError(404, 'コメントが見つかりません');
  return json({ ok: true });
}
async function adminDeleteComment(env, id) {
  await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(Number(id)).run();
  return json({ ok: true });
}

// ---------- 入力チェック・共通 ----------
// ゲームのURLが scratch.mit.edu / turbowarp.org の作品ページなら、種類と作品IDを自動判定する
function parseGameUrl(url) {
  let m = /^https:\/\/(?:www\.)?scratch\.mit\.edu\/projects\/(\d{1,15})(?:[/?#]|$)/.exec(url);
  if (m) return { type: 'scratch', scratchId: m[1] };
  m = /^https:\/\/(?:www\.)?turbowarp\.org\/(\d{1,15})(?:[/?#]|$)/.exec(url);
  if (m) return { type: 'turbowarp', scratchId: m[1] };
  return { type: '', scratchId: '' };
}

// 新規ゲームのIDを自動採番する(Scratch/TurboWarpなら作品ID、それ以外はランダムな文字列)
function genId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'g' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function validateGame(raw, existingId) {
  const url = String(raw.url || '').trim();
  if (!/^https:\/\/\S{1,500}$/.test(url)) throw new HttpError(400, 'ゲームのURLは https:// から始めてください');
  const { type, scratchId } = parseGameUrl(url);
  const id = existingId || (type ? scratchId : genId());
  const title = clean(raw.title, 60);
  if (!title) throw new HttpError(400, 'タイトルを入れてください');
  const thumbnail = String(raw.thumbnail || '').trim();
  if (thumbnail && !/^(https:\/\/|assets\/)\S{1,500}$/.test(thumbnail)) throw new HttpError(400, 'サムネイルは https:// か assets/ から始まるパスにしてください');
  return {
    id, title, type,
    author: clean(raw.author, 40),
    description: cleanMultiline(raw.description, 300),
    thumbnail, scratchId: type ? scratchId : '', url: type ? '' : url,
    visible: raw.visible === false || raw.visible === 0 ? 0 : 1,
  };
}

function toGame(r) {
  const g = { id: r.id, title: r.title, author: r.author, description: r.description, thumbnail: r.thumbnail };
  if (r.type) { g.type = r.type; g.scratchId = r.scratch_id; } else { g.url = r.url; }
  return g;
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
// 説明欄など複数行を許したい項目用。改行(\n)だけは残し、それ以外の制御文字は空白に置き換える。
function cleanMultiline(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}
function now() { return Math.floor(Date.now() / 1000); }

async function readJson(request) {
  const text = await request.text();
  if (text.length > 100000) throw new HttpError(413, 'データが大きすぎます');
  try { return JSON.parse(text || '{}') || {}; } catch { throw new HttpError(400, 'JSONが正しくありません'); }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin' };
  if (allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Credentials'] = 'true';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}
