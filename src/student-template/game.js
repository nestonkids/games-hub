// ===== 設定 =====
const GAME_ID = 'mygame'; // 自分のゲーム名に変える（英数字）
const WIDTH = 800;
const HEIGHT = 600;

// localStorage のキーには必ず GAME_ID を付ける（他のゲームとぶつからないため）
function saveKey(name) { return 'game_' + GAME_ID + '_' + name; }

const canvas = document.getElementById('game');
const stage = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ===== 画面の拡大縮小（比率を保ってウィンドウに収める）=====
function fitToWindow() {
  const scale = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
  stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
}
window.addEventListener('resize', fitToWindow);
fitToWindow();

// ===== キー入力 =====
const keys = {};
window.addEventListener('keydown', (e) => {
  // 矢印キーとSpaceは、ポータル側がスクロールしないように止める
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault();
  }
  keys[e.key] = true;
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

// ===== ゲームの状態 =====
let started = false; // クリックするまで false
let player = { x: 380, y: 280, size: 40, speed: 4 };
let highScore = Number(localStorage.getItem(saveKey('highscore'))) || 0;

// 「クリックしてスタート」: Canvasにフォーカスを当ててゲーム開始
canvas.addEventListener('click', () => {
  started = true;
  canvas.focus();
});

// ===== 1コマごとの更新 =====
function update() {
  if (keys['ArrowLeft']) player.x -= player.speed;
  if (keys['ArrowRight']) player.x += player.speed;
  if (keys['ArrowUp']) player.y -= player.speed;
  if (keys['ArrowDown']) player.y += player.speed;
  // 画面の外に出ないようにする
  player.x = Math.max(0, Math.min(WIDTH - player.size, player.x));
  player.y = Math.max(0, Math.min(HEIGHT - player.size, player.y));
}

// ===== 描画 =====
function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  if (!started) {
    ctx.font = '36px sans-serif';
    ctx.fillText('画面をクリックしてスタート', WIDTH / 2, HEIGHT / 2);
    return;
  }
  ctx.fillStyle = '#4af';
  ctx.fillRect(player.x, player.y, player.size, player.size);
  ctx.fillStyle = '#fff';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ハイスコア: ' + highScore, 10, 28);
}

// ===== メインループ =====
function loop() {
  if (started) update();
  draw();
  requestAnimationFrame(loop);
}
loop();
