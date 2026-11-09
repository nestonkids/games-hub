// 管理画面。表示する文字はすべて textContent で入れる(HTMLとして解釈させない)
// このAPIはCloudflare Access(Zero Trust)で保護されているため、画面側にログイン機構は持たない。
const API = (window.HUB_CONFIG && window.HUB_CONFIG.apiBase || '').replace(/\/+$/, '');
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let games = [];
let editingId = null; // null = 新規追加

function say(msg) { statusEl.textContent = msg || ''; }

async function api(path, method = 'GET', body) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(API + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'エラーが起きました');
  return data;
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function btn(label, onClick, cls) {
  const b = el('button', label, cls);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await onClick(); } catch (e) { say(e.message); }
    b.disabled = false;
  });
  return b;
}

// ---------- タブ ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('tab-comments').hidden = b.dataset.tab !== 'comments';
  $('tab-games').hidden = b.dataset.tab !== 'games';
  say('');
}));

// ---------- コメント ----------
document.querySelectorAll('input[name=cstatus]').forEach((r) => r.addEventListener('change', loadComments));

async function loadComments() {
  const status = document.querySelector('input[name=cstatus]:checked').value;
  try {
    const { comments } = await api('/api/admin/comments?status=' + status);
    const list = $('comment-list');
    list.replaceChildren();
    if (!comments.length) list.appendChild(el('li', '該当するコメントはありません。'));
    comments.forEach((c) => list.appendChild(renderCommentItem(c, loadComments)));
  } catch (e) { say(e.message); }
  refreshPendingCount();
}

async function refreshPendingCount() {
  try {
    const { comments } = await api('/api/admin/comments?status=pending');
    $('pending-count').textContent = comments.length ? '(' + comments.length + ')' : '';
  } catch (e) { /* 件数表示だけなので失敗してもここでは何もしない */ }
}

// コメント1件分の行を作る(コメントタブ・ゲームごとのコメント欄の両方で使う)
// onChanged: 承認・非公開・削除のあとに呼ぶコールバック(その場で再読み込みする)
function renderCommentItem(c, onChanged) {
  const li = document.createElement('li');
  const main = el('div', null, 'main');
  const head = el('div');
  head.append(
    el('span', c.status === 'approved' ? '公開中' : '承認待ち', 'comment-status ' + c.status),
    document.createTextNode(c.nickname + ' : ' + c.body)
  );
  main.append(
    head,
    el('div', (c.game_title || c.game_id) + ' / ' + new Date(c.created_at * 1000).toLocaleString('ja-JP'), 'meta')
  );
  const btns = el('div', null, 'btns');
  if (c.status === 'approved') {
    btns.appendChild(btn('非公開にする', async () => { await api('/api/admin/comments/' + c.id + '/unapprove', 'POST'); onChanged(); }));
  } else {
    btns.appendChild(btn('承認', async () => { await api('/api/admin/comments/' + c.id + '/approve', 'POST'); onChanged(); }, 'primary'));
  }
  btns.appendChild(btn('削除', async () => {
    if (!confirm('このコメントを削除しますか？')) return;
    await api('/api/admin/comments/' + c.id, 'DELETE');
    onChanged();
  }, 'danger'));
  li.append(main, btns);
  return li;
}

// ゲーム1件分のコメント一覧(承認待ち・公開中の両方)を読み込んで表示する
async function loadGameComments(gameId, listEl) {
  listEl.replaceChildren(el('li', '読み込み中…'));
  try {
    const { comments } = await api('/api/admin/comments?game_id=' + encodeURIComponent(gameId));
    listEl.replaceChildren();
    if (!comments.length) { listEl.appendChild(el('li', 'コメントはありません。')); return; }
    const reload = async () => { await loadGameComments(gameId, listEl); refreshPendingCount(); };
    comments.forEach((c) => listEl.appendChild(renderCommentItem(c, reload)));
  } catch (e) {
    listEl.replaceChildren(el('li', e.message));
  }
}

// ---------- ゲーム ----------
async function loadGames() {
  try {
    games = (await api('/api/admin/games')).games;
    renderGames();
  } catch (e) { say(e.message); }
}

function renderGames() {
  const list = $('game-list');
  list.replaceChildren();
  if (!games.length) list.appendChild(el('li', 'ゲームがありません。「＋ ゲームを追加」から登録してください。'));
  games.forEach((g, i) => {
    const li = document.createElement('li');
    const main = el('div', null, 'main');
    const title = el('div', g.title + '(' + g.id + ') ');
    if (!g.visible) title.appendChild(el('span', '非公開', 'tag-hidden'));
    main.append(title, el('div', g.author || '作者なし', 'meta'));

    const commentsPanel = el('div', null, 'game-comments');
    commentsPanel.hidden = true;
    const commentsList = el('ul', null, 'items');
    commentsPanel.appendChild(commentsList);

    const btns = el('div', null, 'btns');
    btns.append(
      btn('↑', () => move(i, -1)),
      btn('↓', () => move(i, 1)),
      btn(g.visible ? '非公開にする' : '公開する', async () => {
        await api('/api/admin/games/' + g.id, 'PUT', { ...g, url: gameUrl(g), visible: !g.visible });
        loadGames();
      }),
      btn('編集', async () => openForm(g)),
      btn('💬 コメント', async () => {
        commentsPanel.hidden = !commentsPanel.hidden;
        if (!commentsPanel.hidden) await loadGameComments(g.id, commentsList);
      }),
      btn('削除', async () => {
        if (!confirm('「' + g.title + '」と、そのいいね・コメントを削除しますか？')) return;
        await api('/api/admin/games/' + g.id, 'DELETE');
        loadGames();
      }, 'danger')
    );
    li.append(main, btns, commentsPanel);
    list.appendChild(li);
  });
}

async function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= games.length) return;
  [games[i], games[j]] = [games[j], games[i]];
  await api('/api/admin/games/reorder', 'POST', { ids: games.map((g) => g.id) });
  renderGames();
}

const form = $('game-form');
// form.id など、フォーム自身のプロパティと名前が重ならないよう elements 経由で読む
const F = form.elements;

function gameUrl(g) {
  if (g.type === 'scratch') return 'https://scratch.mit.edu/projects/' + g.scratchId + '/';
  if (g.type === 'turbowarp') return 'https://turbowarp.org/' + g.scratchId;
  return g.url || '';
}

function openForm(g) {
  editingId = g ? g.id : null;
  $('game-form-title').textContent = g ? '「' + g.title + '」を編集' : 'ゲームを追加';
  form.reset();
  if (g) {
    F.url.value = gameUrl(g); F.title.value = g.title; F.author.value = g.author;
    F.description.value = g.description; F.thumbnail.value = g.thumbnail;
    F.visible.checked = g.visible;
  }
  form.hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('new-game').addEventListener('click', () => openForm(null));
$('game-cancel').addEventListener('click', () => { form.hidden = true; });

// URLがScratch/TurboWarpの作品ページなら、そこからタイトル・作者・サムネイル・説明を自動入力する
$('fetch-scratch').addEventListener('click', async () => {
  const url = F.url.value.trim();
  const m = /^https:\/\/(?:www\.)?(?:scratch\.mit\.edu\/projects|turbowarp\.org)\/(\d+)/.exec(url);
  if (!m) { say('Scratch または TurboWarp の作品URLを入力してから押してください'); return; }
  try {
    const info = await api('/api/admin/scratch/' + m[1]);
    if (info.title) F.title.value = info.title;
    if (info.author) F.author.value = info.author;
    if (info.description) F.description.value = info.description;
    if (info.thumbnail) F.thumbnail.value = info.thumbnail;
    say('Scratchから取得しました');
  } catch (e) { say(e.message); }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: F.title.value, author: F.author.value,
    description: F.description.value, thumbnail: F.thumbnail.value,
    url: F.url.value.trim(), visible: F.visible.checked,
  };
  try {
    if (editingId) await api('/api/admin/games/' + editingId, 'PUT', body);
    else await api('/api/admin/games', 'POST', body);
    form.hidden = true;
    say('保存しました');
    loadGames();
  } catch (err) { say(err.message); }
});

if (!API) say('js/config.js の apiBase が空です。APIのURLを設定してください。');
loadComments();
loadGames();
