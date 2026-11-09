-- ゲーム一覧(管理画面から編集する)
CREATE TABLE IF NOT EXISTS games (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT '',      -- '' / 'scratch' / 'turbowarp'
  scratch_id  TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- コメント(status: pending=承認待ち / approved=公開)
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL,
  nickname   TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_game ON comments (game_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at);
