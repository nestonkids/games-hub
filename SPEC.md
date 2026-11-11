# NESTON Games Hub 仕様書

## 1. 概要
- **サイト名**: NESTON Games Hub
- **目的**: 小中高生プログラミング教室の生徒が作ったWebゲームを一箇所に集め、生徒同士のプレイや保護者・外部への公開に使う。
- **ホスティング**:
  - 公開ポータル(front) … GitHub Pages(教室用Organizationで運用)
  - ゲーム本体 … 生徒ごとのGitHubリポジトリ(GitHub Pagesで個別公開)
  - 管理画面(admin)・API … Cloudflare(Pages / Workers / D1 / Access)

## 2. システム構成
### 2.1 マルチリポジトリ構成
| リポジトリ | 数 | 役割 |
|---|---|---|
| `neston-games-hub`(本リポジトリ) | 1 | ポータルサイト・管理画面・API |
| 生徒ごとのゲームリポジトリ | 生徒数 | ゲーム本体(GitHub Pagesで個別公開) |

ポータルは、生徒側で公開されたゲームのURLを読み込む(iframe または別タブ)。

**メリット**
- 生徒間のコード干渉や誤操作で、ポータル全体が壊れるのを防げる。
- 生徒が自分のリポジトリと独立したURLを持つ体験ができる(Git/GitHubの教育的価値)。

### 2.2 このリポジトリのフォルダ構成
```
neston-games-hub/
├─ SPEC.md              本書
├─ README.md            使い方
├─ .github/workflows/pages.yml  src/front を GitHub Pages に公開するワークフロー
├─ src/
│  ├─ front/            公開ポータル本体(GitHub Pagesに公開)
│  │  ├─ index.html
│  │  ├─ css/style.css
│  │  ├─ js/app.js, js/config.js
│  │  └─ assets/thumbs/ サムネイル画像を置く場所(管理画面でサムネイルURLに相対パスを指定した場合用)
│  ├─ admin/            管理画面(Cloudflare Pagesにのみデプロイ)
│  │  ├─ index.html
│  │  ├─ css/admin.css
│  │  ├─ js/admin.js, js/config.js
│  │  ├─ functions/api/[[path]].js  Pages Functions。Service Binding経由でworker/adminに中継する
│  │  └─ wrangler.toml
├─ sample-web-game/     生徒がAIエージェントと一緒にゲームを作るときのルール(AGENTS.md)
│  └─ AGENTS.md
└─ worker/              Cloudflare Workers(API)
   ├─ front/             公開側API(ゲーム一覧・コメント投稿、認証なし)
   │  ├─ src/index.js
   │  └─ wrangler.toml
   ├─ admin/             管理側API(ゲーム編集・コメント承認。Cloudflare Accessで保護)
   │  ├─ src/index.js
   │  └─ wrangler.toml
   └─ schema.sql         D1データベースのテーブル定義(games / comments)
```
- 公開対象は `src/front/`(`src/admin/` はCloudflare Pages専用で意図的にGitHub Pagesには公開しない)。
- GitHub Pages はブランチの `/`(root)か `/docs` しか直接指定できず、`src/front` のようなネストしたフォルダは指定できないため、GitHub Actions(`actions/upload-pages-artifact` + `actions/deploy-pages`)で `src/front` をアップロードしている。
- `src/admin/` を分けているのは、管理画面をCloudflare Access(Zero Trust)で保護する一方、GitHub Pages側の公開物には管理画面を一切含めず、保護されていない入り口を作らないため。

### 2.3 Cloudflare構成
| サービス | リソース名 | 役割 |
|---|---|---|
| Workers | `neston-games-hub-api`(`worker/front`) | 公開側API。ゲーム一覧の配信、コメントの投稿・閲覧。認証なし |
| Workers | `neston-games-hub-admin-api`(`worker/admin`) | 管理側API。ゲームの追加・編集・削除、コメント承認。Cloudflare Accessで保護 |
| Pages | `neston-games-hub-admin`(`src/admin`) | 管理画面(静的ファイル + Pages Functions) |
| D1 | `neston-games-hub-db` | `games` / `comments` テーブル(詳細は5章) |
| Access(Zero Trust) | Applications | 管理画面(Pages)と管理API(Worker)の両方を保護するアプリケーション設定 |

**管理画面のログインを1回にする仕組み**
管理API(`worker/admin`)と管理画面(`src/admin`)は別ドメインのため、両方を個別にCloudflare Accessで保護すると2回ログインが必要になり、かつAccessの認証リダイレクトはCORSヘッダーを持たないためブラウザから直接APIを呼ぶと `Failed to fetch` になる。これを避けるため、
1. `src/admin/wrangler.toml` で管理API Workerへの **Service Binding**(`ADMIN_API`)を設定する。
2. `src/admin/functions/api/[[path]].js`(Pages Functions)が、受け取ったリクエストをそのままService Binding経由で管理APIのWorkerに渡す。
3. `src/admin/js/config.js` の `apiBase` は空文字にし、管理画面と同一オリジン(`/api/admin/...`)でAPIを呼ぶ。

これにより、Cloudflare Accessのログインは管理画面(Pages)側の1回だけで済む(Service Binding経由の呼び出しはAccessを経由しない内部呼び出しのため)。管理API WorkerのURLを直接開いた場合は、そちらのAccessアプリケーションでログインが必要になる。

## 3. ポータル(front)の仕様
### 3.1 データの取得元
- `js/config.js` の `apiBase`(`worker/front` のURL)に `GET {apiBase}/api/games` を呼び、D1に保存されているゲーム一覧を表示する。
- APIが呼べない場合は、一覧エリアに「ゲーム一覧を読み込めませんでした。」と表示するだけで、代替の静的データは持たない(以前あった `games.json` によるフォールバック/試用モードは廃止済み)。
- 実際のゲーム一覧は、すべて管理画面で編集してD1に保存したデータ。

### 3.2 ゲーム一覧画面
- 各ゲームをカード形式で表示する。表示項目はタイトル、作者名、サムネイル(4:3)、説明文、コメント数(API利用時のみ)。
- 並び順は**投稿日時(`created_at`)の新しい順固定**(手動並べ替えはない)。
- 一覧画面では iframe を読み込まない(メモリ・音声・スクリプト多重起動の対策)。
- サムネイルは `loading="lazy"`。画像がない・読み込めない場合は、カードごとの色付き枠の中央に🎮アイコンを表示する。
- 作者名が未設定の場合は「ひみつ」、説明文が未設定の場合は「せつめいはまだありません」と表示する(空欄のまま見せない)。
- 文字は `textContent` で挿入する(HTMLとして解釈させない)。

### 3.3 ゲーム起動方式
`js/app.js` の `launchMode` 定数で固定(現在は `"modal"`)。設定ファイルでの切り替えは廃止し、コード上の定数のみで決める。

| 値 | 動作 |
|---|---|
| `"tab"` | カードのクリックで別タブ(`target="_blank"`、`rel="noopener"`)に開く。トラブルが最も少ない。 |
| `"modal"`(現在の設定) | カードのクリックで全画面モーダルを開き、iframe を動的に生成する。閉じる(ボタン / Esc)と iframe を削除し、音や処理を止める。 |

**iframe 属性**
```html
<iframe src="[ゲームURL]" sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        allow="autoplay; fullscreen" title="ゲーム名">
```
- `allow-pointer-lock` は、マウスを動かし続けて視点やキャラクターを操作するタイプのゲーム(Pointer Lock APIを使うもの)が動作するために必要。
- `loading="lazy"` は、iframe を開くときに動的生成するので付けていない。

### 3.4 コメント機能(API利用時のみ)
- カード下の「💬」ボタン、またはモーダル内の「💬 コメント」ボタンから開く。
- 投稿されたコメントは最初「承認待ち」状態になり、管理画面で承認するまで一般には表示されない。
- 投稿時はニックネーム・本文を入力する。荒らし対策として、同一IPからの連続投稿(1分に3件まで)と、承認待ちコメントの総数(200件まで)を制限している。
- 一覧は新しい順に30件ずつ取得し、ダイアログを下までスクロールすると続きを読み込む。

### 3.5 ゲームの種類(`type`)
`GET /api/games` が返す各ゲームは、`type` によってURLの組み立て方が変わる。

| `type` | 持っている情報 | 別タブで開くURL | iframe に入れるURL |
|---|---|---|---|
| (省略) 自作ゲーム | `url` | `url` | `url` |
| `"scratch"` | `scratchId` | `https://scratch.mit.edu/projects/<ID>/` | `https://scratch.mit.edu/projects/<ID>/embed` |
| `"turbowarp"` | `scratchId` | `https://turbowarp.org/<ID>` | `https://turbowarp.org/<ID>/embed` |

- Scratch / TurboWarp は、Scratch 公式サイトで「共有」されている作品だけが埋め込める。
- 作品ページのURLは iframe では開けないため、埋め込み専用URLを使う。
- 6.の開発ルールは自作ゲーム向けで、Scratch には適用しない。

ゲームの追加・編集は、このデータを直接編集するのではなく、**管理画面から行う**(4章)。

## 4. 管理画面(admin)の仕様
### 4.1 認証
- `src/admin` はCloudflare Pages専用。Cloudflare Access(Zero Trust)で保護し、`@nestonkids.com` のメールでログインした人だけが開ける。
- 認証の仕組みは2.3節のとおり(Pages Functions + Service Bindingで管理APIを中継し、ログインは1回のみ)。

### 4.2 ゲームの追加・編集
- 「＋ ゲームを追加」ボタン、または各ゲームの「編集」ボタンでモーダルを開く。
- 入力項目: ゲームのURL、タイトル、作者、説明、サムネイルURL、公開するかどうか。
- 保存すると、URLが `scratch.mit.edu/projects/<ID>` または `turbowarp.org/<ID>` のパターンに一致する場合は自動で `type`/`scratchId` を判定し、それ以外はそのまま自作ゲームの `url` として保存する。
- 「ゲーム情報を取得」ボタンで、入力したURLから情報を自動入力できる(4.3節)。
- サムネイルURL入力欄の下にプレビュー画像を表示する(読み込めない場合は非表示)。
- モーダル内で発生したエラー・成功メッセージは、モーダル内(公開チェックボックスの下)に表示する(モーダル表示中は背面の通常のステータス表示が見えないため)。
- 一覧には各ゲームの小さめのサムネイル(64×48px)、タイトル、作者、公開/非公開状態、操作ボタン(非公開化/編集/コメント/削除)を表示する。並び順は投稿日時の新しい順固定。

### 4.3 情報の自動取得
「ゲーム情報を取得」ボタンは、入力されたURLのパターンで自動的にどちらを使うか判定する。

| URLのパターン | 取得先 | 取得できる項目 |
|---|---|---|
| `scratch.mit.edu/projects/<ID>` または `turbowarp.org/<ID>` | Scratch公式API(Worker経由で中継。ブラウザから直接呼ぶとCORSで弾かれるため) | タイトル・作者・説明(使い方 or Notes and Credits)・サムネイル |
| それ以外のURL | そのURL直下の `game.json`(生徒が公開する、`sample-web-game/AGENTS.md` で定める形式) | タイトル・作者・サムネイル |

`game.json` 取得時は、https限定・5秒タイムアウト・レスポンス50KB上限などの制限をかけて、生徒のURLを安全に取得する。

### 4.4 コメントの承認
- 「コメント」タブで、承認待ち/公開中を切り替えて一覧表示する。各ゲームの「💬 コメント」ボタンからも、そのゲームのコメントだけを見られる。
- 承認待ちコメントは「承認」ボタンで公開、公開中コメントは「非公開にする」ボタンで承認待ちに戻せる(削除はしない)。
- 「削除」ボタンで完全に削除する。

## 5. データベース(D1: `neston-games-hub-db`)
```sql
CREATE TABLE games (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT '',      -- '' / 'scratch' / 'turbowarp'
  scratch_id  TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  visible     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT NOT NULL,
  nickname   TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending / approved
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
```
- `games.id` は、Scratch/TurboWarpの場合は作品ID、それ以外はランダムな文字列を自動採番する。
- ゲームの並び順に使う列は持たず、`created_at` の新しい順で固定表示する(以前はあった手動並べ替え用の `sort_order` 列は廃止済み)。

## 6. 生徒リポジトリの開発ルール(`sample-web-game/AGENTS.md`)
Claude Code・ChatGPTなどのAIコーディングエージェントと一緒にWebゲームを作る生徒向けの指示ファイル。要点は以下。
- 素のHTML・CSS・JavaScriptのみ(ビルド不要)。外部ライブラリは一般的によく使われているもの(Phaser、p5.js、GSANなど)ならCDN経由で利用可。
- コードはシンプルに、まとまった処理の前には日本語でコメント。
- 内容・表現について、年齢的にふさわしくない表現を禁止する基準を明記。
- 公開時は、リポジトリ直下に `game.json`(`{ title, author, thumbnail }`)を作成する(4.3節の自動取得機能が読み取る)。
- GitHubリポジトリ名は `苗字(ローマ字)-名前の頭文字-アプリ名` の形式にする(例: `yamada-t-dice-game`)。

(以前あった素のコード向けテンプレート `src/student-template/` は、実際には1件も使われず目的が重複していたため削除済み)

## 7. 今後のタスク
- [x] `src/front` を公開する GitHub Actions ワークフローを用意する
- [ ] 実機テスト(矢印キー操作時のスクロール、タブレットでの表示崩れ)
- [ ] 実測を踏まえ、起動方式(別タブ / モーダル)を最終決定する
- [x] 実際のゲームとサムネイルの登録(管理画面経由で2件登録済み)
