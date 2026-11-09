// games.json を読み込んで、ゲームカードを並べる
const listEl = document.getElementById('game-list');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalAuthor = document.getElementById('modal-author');
const modalBody = document.getElementById('modal-body');
const descDialog = document.getElementById('desc-dialog');
const descTitle = document.getElementById('desc-title');
const descText = document.getElementById('desc-text');
let launchMode = 'modal'; // 'modal' = モーダルで開く / 'tab' = 別タブで開く

const API = (window.HUB_CONFIG && window.HUB_CONFIG.apiBase || '').replace(/\/+$/, '');

// ゲーム一覧: APIが使えればAPIから、だめなら games.json から読む(設定 launchMode は games.json から)
loadGames().catch(() => { listEl.textContent = 'ゲーム一覧を読み込めませんでした。'; });

async function loadGames() {
  const data = await (await fetch('games.json')).json();
  launchMode = (data.config && data.config.launchMode) || 'modal';
  let games = data.games;
  let fromApi = false;
  if (API) {
    try {
      const res = await fetch(API + '/api/games');
      if (res.ok) { games = (await res.json()).games; fromApi = true; }
    } catch (e) { /* APIに繋がらないときは games.json のまま表示する */ }
  }
  // 試用モード: APIが使えないとき、コメントをこの端末だけに保存して動かす(config.js の offlineDemo)
  if (!fromApi && window.HUB_CONFIG && window.HUB_CONFIG.offlineDemo) {
    games = games.map(demoGame);
    const note = textEl('p', 'demo-note', 'テスト表示中：コメントはこの端末だけに保存されます。');
    listEl.before(note);
  }
  games.forEach((game) => listEl.appendChild(createCard(game)));
  if (fromApi) preloadComments(games); // コメントを開く前に裏で読み込んでおく(クリック時の待ち時間を減らす)
}

// 一覧表示後、ゲームを1件ずつ順番にバックグラウンド取得してキャッシュする(一斉に投げて負荷をかけないため)
// キャッシュには最初の1ページ分だけ持つ(続きはダイアログを下までスクロールしたときに読み込む)
const commentsCache = new Map(); // game.id -> { comments, hasMore }
async function preloadComments(games) {
  for (const game of games) {
    if (game.comments === undefined) continue; // コメント機能が無いゲームはスキップ
    try {
      commentsCache.set(game.id, await fetchCommentsPage(game.id));
    } catch (e) { /* 失敗してもここでは何もしない。開くときに通常どおり取得し直す */ }
  }
}

// コメントを新しい順に1ページ分取得する。beforeId を渡すと、その続き(もっと古いコメント)を取得する
async function fetchCommentsPage(gameId, beforeId) {
  let path = '/api/games/' + encodeURIComponent(gameId) + '/comments';
  if (beforeId) path += '?before=' + beforeId;
  return api(path); // { comments, hasMore }
}

// ---- 試用モード用の保存(localStorage) ----
function demoStore() {
  try { return JSON.parse(localStorage.getItem('hub_demo') || '{}'); } catch (e) { return {}; }
}
function demoSave(s) {
  try { localStorage.setItem('hub_demo', JSON.stringify(s)); } catch (e) { /* 保存できない環境では何もしない */ }
}
function demoGame(g) {
  const s = demoStore();
  return { ...g, demo: true, comments: ((s.comments || {})[g.id] || []).length };
}

async function api(path, options) {
  const res = await fetch(API + path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'エラーが起きました');
  return body;
}

// ゲームの種類ごとにURLを決める
// type: 'scratch'（Scratch公式）/ 'turbowarp'（TurboWarp）/ 省略（自作ゲーム。urlをそのまま使う）
// pageUrl = 別タブで開くURL、embedUrl = iframeに入れるURL
function pageUrl(game) {
  if (game.type === 'scratch') return 'https://scratch.mit.edu/projects/' + game.scratchId + '/';
  if (game.type === 'turbowarp') return 'https://turbowarp.org/' + game.scratchId;
  return game.url;
}
function embedUrl(game) {
  if (game.type === 'scratch') return 'https://scratch.mit.edu/projects/' + game.scratchId + '/embed';
  if (game.type === 'turbowarp') return 'https://turbowarp.org/' + game.scratchId + '/embed';
  return game.url;
}

// 1ゲーム分のカードを作る（textContentを使うので、文字がHTMLとして解釈されない）
function createCard(game) {
  const li = document.createElement('li');
  li.className = 'card';

  // 別タブ方式ならリンク、モーダル方式ならボタンにする
  const el = document.createElement(launchMode === 'tab' ? 'a' : 'button');
  el.className = 'card-button';
  if (launchMode === 'tab') {
    el.href = pageUrl(game);
    el.target = '_blank';
    el.rel = 'noopener';
  } else {
    el.type = 'button';
    el.addEventListener('click', () => openModal(game));
  }

  const img = document.createElement('img');
  img.className = 'card-thumb';
  img.src = game.thumbnail || '';
  img.alt = game.title + ' のサムネイル';
  img.loading = 'lazy';
  img.onerror = () => { img.removeAttribute('src'); }; // 画像がなければ灰色の枠のまま

  const body = document.createElement('div');
  body.className = 'card-body';
  body.append(
    textEl('h2', 'card-title', game.title),
    textEl('p', 'card-author', 'つくった人: ' + game.author),
    textEl('p', 'card-desc', game.description)
  );

  el.append(img, body);
  li.appendChild(el);
  if (game.comments !== undefined) li.appendChild(createActions(game)); // API経由のときだけ表示
  return li;
}

// カード下の「コメント」ボタン
function createActions(game) {
  const row = document.createElement('div');
  row.className = 'card-actions';

  const cm = document.createElement('button');
  cm.type = 'button';
  cm.className = 'action-btn';
  cm.textContent = '💬 ' + game.comments;
  cm.setAttribute('aria-label', 'コメントを見る・書く（' + game.comments + '）');
  cm.addEventListener('click', () => openComments(game));
  game.commentBtn = cm;

  row.append(cm);
  return row;
}

// コメントのダイアログ
const dialog = document.getElementById('comment-dialog');
const dlgTitle = document.getElementById('comment-title');
const dlgList = document.getElementById('comment-list');
const dlgForm = document.getElementById('comment-form');
const dlgMsg = document.getElementById('comment-msg');
const dlgThanks = document.getElementById('comment-thanks');
let dlgGame = null;
let dlgState = null; // { comments, hasMore, loading }(API利用時のみ。一番下までスクロールしたら続きを読み込む)

async function openComments(game) {
  dlgGame = game;
  dlgState = null;
  dlgTitle.textContent = game.title + ' へのコメント';
  dlgMsg.textContent = '';
  dlgForm.reset();
  dlgForm.hidden = false;
  dlgThanks.hidden = true;
  dialog.showModal();
  if (game.demo) { renderComments((demoStore().comments || {})[game.id] || []); return; }
  const cached = commentsCache.get(game.id);
  if (cached) {
    dlgState = { comments: cached.comments.slice(), hasMore: cached.hasMore, loading: false };
    renderComments(dlgState.comments); // 先読み済みなら待ち時間なしで表示
    return;
  }
  dlgList.replaceChildren(textEl('li', 'comment-empty', '読み込み中…'));
  try {
    const page = await fetchCommentsPage(game.id);
    dlgState = { comments: page.comments, hasMore: page.hasMore, loading: false };
    commentsCache.set(game.id, page);
    renderComments(dlgState.comments);
  } catch (e) {
    dlgList.replaceChildren(textEl('li', 'comment-empty', 'コメントを読み込めませんでした。'));
  }
}

// コメント一覧を一番下までスクロールしたら、続きを読み込む
dlgList.addEventListener('scroll', () => {
  if (!dlgState || dlgState.loading || !dlgState.hasMore) return;
  const nearBottom = dlgList.scrollTop + dlgList.clientHeight >= dlgList.scrollHeight - 40;
  if (nearBottom) loadMoreComments();
});

async function loadMoreComments() {
  dlgState.loading = true;
  const loadingLi = textEl('li', 'comment-empty', '読み込み中…');
  dlgList.appendChild(loadingLi);
  try {
    const lastId = dlgState.comments[dlgState.comments.length - 1].id;
    const page = await fetchCommentsPage(dlgGame.id, lastId);
    dlgState.comments = dlgState.comments.concat(page.comments);
    dlgState.hasMore = page.hasMore;
    loadingLi.remove();
    appendComments(page.comments);
  } catch (e) {
    loadingLi.textContent = '読み込みに失敗しました。';
  } finally {
    dlgState.loading = false;
  }
}

// ニックネームの横に出す、かわいいアイコン(名前から決める。毎回同じ名前なら同じアイコンになる)
const AVATAR_EMOJIS = ['😊', '🐱', '🐶', '⭐', '🌈', '🍀', '🎈', '🚀', '🦄', '🐥'];
function avatarFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_EMOJIS.length;
  return AVATAR_EMOJIS[h];
}

function renderComments(comments) {
  dlgList.replaceChildren();
  if (!comments.length) dlgList.appendChild(textEl('li', 'comment-empty', 'まだコメントはありません。'));
  appendComments(comments);
}

function appendComments(comments) {
  comments.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'comment-item';
    const head = document.createElement('div');
    head.className = 'comment-head';
    head.append(textEl('span', 'comment-icon', avatarFor(c.nickname)), textEl('strong', 'comment-name', c.nickname));
    li.append(head, textEl('p', 'comment-body', c.body));
    dlgList.appendChild(li);
  });
}

dlgForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = dlgForm.querySelector('button[type=submit]');
  btn.disabled = true;
  dlgMsg.textContent = '';
  if (dlgGame.demo) {
    const s = demoStore();
    s.comments = s.comments || {};
    const list = s.comments[dlgGame.id] = s.comments[dlgGame.id] || [];
    list.unshift({ nickname: dlgForm.nickname.value.trim().slice(0, 20), body: dlgForm.body.value.trim().slice(0, 200) });
    demoSave(s);
    dlgForm.body.value = '';
    dlgGame.comments = list.length;
    dlgGame.commentBtn.textContent = '💬 ' + list.length;
    renderComments(list);
    dlgMsg.textContent = 'テスト表示：この端末だけに保存しました';
    btn.disabled = false;
    return;
  }
  try {
    await api('/api/games/' + encodeURIComponent(dlgGame.id) + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: dlgForm.nickname.value, body: dlgForm.body.value }),
    });
    dlgForm.hidden = true;
    dlgThanks.hidden = false;
  } catch (err) {
    dlgMsg.textContent = err.message;
  }
  btn.disabled = false;
});
document.getElementById('comment-close').addEventListener('click', () => dialog.close());
document.getElementById('comment-close-x').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // 外側（背景）をクリックしたら閉じる

function textEl(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

// モーダルを開く：このタイミングで初めてiframeを作る
let modalGame = null;
function openModal(game) {
  modalGame = game;
  const iframe = document.createElement('iframe');
  iframe.src = embedUrl(game);
  iframe.title = game.title;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('allow', 'autoplay; fullscreen');
  modalTitle.textContent = game.title;
  modalAuthor.textContent = 'つくった人: ' + (game.author || 'つくった人なし');
  modalBody.replaceChildren(iframe);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  iframe.focus();
}

// モーダルを閉じる：iframeを削除して、音や処理を止める
function closeModal() {
  modalBody.replaceChildren();
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  modalGame = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-desc').addEventListener('click', () => {
  if (!modalGame) return;
  descTitle.textContent = modalGame.title;
  descText.textContent = modalGame.description || '説明はありません。';
  descDialog.showModal();
});
document.getElementById('desc-close').addEventListener('click', () => descDialog.close());
document.getElementById('desc-close-x').addEventListener('click', () => descDialog.close());
descDialog.addEventListener('click', (e) => { if (e.target === descDialog) descDialog.close(); });
document.getElementById('modal-comment').addEventListener('click', () => { if (modalGame) openComments(modalGame); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.hidden) closeModal();
});
