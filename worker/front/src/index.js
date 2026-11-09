// NESTON Games Hub API - 公開側(front)
// ゲーム一覧 / コメント投稿・閲覧。認証不要(誰でも呼べる)。

const MAX_PENDING = 200; // 承認待ちコメントの上限(荒らし対策)
const IP_HASH_SALT = 'neston-games-hub-front'; // IPを直接保存しないためのソルト(秘密情報ではない)

const enc = new TextEncoder();

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
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/'); // ['api', 'games', ...]
  const m = request.method;
  if (parts[0] !== 'api' || parts[1] !== 'games') throw new HttpError(404, 'not found');

  if (parts.length === 2 && m === 'GET') return listGames(env);
  if (parts.length === 4 && parts[3] === 'comments') {
    if (m === 'GET') return listComments(env, parts[2], url);
    if (m === 'POST') return postComment(request, env, parts[2]);
  }
  throw new HttpError(404, 'not found');
}

async function listGames(env) {
  const { results } = await env.DB.prepare(
    `SELECT g.*,
       (SELECT COUNT(*) FROM comments c WHERE c.game_id = g.id AND c.status = 'approved') AS comments
     FROM games g WHERE g.visible = 1 ORDER BY g.sort_order, g.created_at`
  ).all();
  return json({ games: results.map((r) => ({ ...toGame(r), comments: r.comments })) });
}

const COMMENTS_PAGE_SIZE = 30;

// 新しい順に COMMENTS_PAGE_SIZE 件ずつ返す。?before=<id> を付けると、その id より古いコメントから続きを返す
async function listComments(env, gameId, url) {
  const before = Number(url.searchParams.get('before'));
  let query = `SELECT id, nickname, body, created_at FROM comments WHERE game_id = ? AND status = 'approved'`;
  const params = [gameId];
  if (before) { query += ' AND id < ?'; params.push(before); }
  query += ' ORDER BY id DESC LIMIT ?';
  params.push(COMMENTS_PAGE_SIZE + 1); // +1件多く取って、続きがあるか判定する

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const hasMore = results.length > COMMENTS_PAGE_SIZE;
  const comments = hasMore ? results.slice(0, COMMENTS_PAGE_SIZE) : results;
  return json({ comments, hasMore });
}

async function postComment(request, env, gameId) {
  const body = await readJson(request);
  const nickname = clean(body.nickname, 20);
  const text = clean(body.body, 200);
  if (!nickname) throw new HttpError(400, 'ニックネームを入れてね');
  if (!text) throw new HttpError(400, 'コメントを入れてね');
  await requireVisibleGame(env, gameId);

  const ipHash = await hashIp(request);
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM comments WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now() - 60).first();
  if (recent.n >= 3) throw new HttpError(429, 'ちょっと待ってからもう一度送ってね');
  const pending = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'pending'").first();
  if (pending.n >= MAX_PENDING) throw new HttpError(503, 'いまコメントを受け付けられません');

  await env.DB.prepare('INSERT INTO comments (game_id, nickname, body, status, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(gameId, nickname, text, 'pending', ipHash, now()).run();
  return json({ ok: true, message: 'ありがとう！先生が確認したあとに表示されるよ' }, 201);
}

// ---------- 共通 ----------
function toGame(r) {
  const g = { id: r.id, title: r.title, author: r.author, description: r.description, thumbnail: r.thumbnail };
  if (r.type) { g.type = r.type; g.scratchId = r.scratch_id; } else { g.url = r.url; }
  return g;
}

async function requireVisibleGame(env, id) {
  const g = await env.DB.prepare('SELECT 1 FROM games WHERE id = ? AND visible = 1').bind(id).first();
  if (!g) throw new HttpError(404, 'ゲームが見つかりません');
}

// 制御文字を除き、前後の空白を削って、長さを制限する
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function now() { return Math.floor(Date.now() / 1000); }

async function hashIp(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await crypto.subtle.importKey('raw', enc.encode(IP_HASH_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('ip.' + ip)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
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
