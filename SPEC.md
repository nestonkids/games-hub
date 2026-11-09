# NESTON Games Hub 仕様書

## 1. 概要
- **サイト名**: NESTON Games Hub
- **目的**: 小中学生プログラミング教室の生徒が作ったWebゲームを一箇所に集め、生徒同士のプレイや保護者・外部への公開に使う。
- **ホスティング**: GitHub Pages(教室用Organizationで運用)

## 2. システム構成
### 2.1 マルチリポジトリ構成
| リポジトリ | 数 | 役割 |
|---|---|---|
| `neston-games-hub` | 1 | ポータルサイト |
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
└─ src/
   ├─ front/            公開ポータル本体(GitHub Pagesに公開)
   │  ├─ index.html
   │  ├─ games.json     作品リスト・設定
   │  ├─ css/style.css
   │  ├─ js/app.js, js/config.js
   │  └─ assets/thumbs/ サムネイル画像
   ├─ admin/            管理画面(Cloudflare Pagesにのみデプロイ)
   │  ├─ index.html
   │  ├─ css/admin.css
   │  └─ js/admin.js, js/config.js
   └─ student-template/ 生徒用スターターテンプレート
      ├─ AGENTS.md / .cursorrules / .github/copilot-instructions.md
      ├─ index.html / style.css / game.js
      └─ assets/
```
- 公開対象は `src/front/`(`student-template/` は別リポジトリのテンプレート用、`src/admin/` はCloudflare Pages専用で意図的にGitHub Pagesには公開しない)。
- GitHub Pages はブランチの `/`(root)か `/docs` しか直接指定できず、`src/front` のようなネストしたフォルダは指定できないため、GitHub Actions(`actions/upload-pages-artifact` + `actions/deploy-pages`)で `src/front` をアップロードしている。
- `src/admin/` を分けているのは、管理画面をCloudflare Access(Zero Trust)で保護する一方、GitHub Pages側の公開物には管理画面を一切含めず、保護されていない入り口を作らないため。

## 3. ポータルの仕様
### 3.1 ゲーム一覧画面
- 各ゲームをカード形式で表示する。表示項目はタイトル、作者名、サムネイル(4:3)、説明文。
- 一覧画面では iframe を読み込まない(メモリ・音声・スクリプト多重起動の対策)。
- サムネイルは `loading="lazy"`。画像がなければ灰色の枠を表示する。
- 文字は `textContent` で挿入する(HTMLとして解釈させない)。

### 3.2 ゲーム起動方式
`games.json` の `config.launchMode` で切り替える。

| 値 | 動作 |
|---|---|
| `"tab"`(案A) | カードのクリックで別タブ(`target="_blank"`、`rel="noopener"`)に開く。トラブルが最も少ない。 |
| `"modal"`(案B、現在の設定) | カードのクリックで全画面モーダルを開き、iframe を動的に生成する。閉じる(ボタン / Esc)と iframe を削除し、音や処理を止める。 |

**iframe 属性**
```html
<iframe src="[ゲームURL]" sandbox="allow-scripts allow-same-origin"
        allow="autoplay; fullscreen" title="ゲーム名">
```
`loading="lazy"` は、iframe を開くときに動的生成するので付けていない。

### 3.3 `games.json` のスキーマ
```json
{
  "config": { "launchMode": "modal" },
  "games": [
    {
      "id": "invader",
      "title": "ゲーム名",
      "author": "作者名",
      "description": "説明文",
      "thumbnail": "assets/thumbs/invader.png",
      "url": "https://<org>.github.io/<repo>/"
    }
  ]
}
```
ゲームの追加は `games` に1件足すだけでよい。

**ゲームの種類(`type`)**
| `type` | 必須項目 | 別タブで開くURL | iframe に入れるURL |
|---|---|---|---|
| (省略) 自作ゲーム | `url` | `url` | `url` |
| `"scratch"` | `scratchId` | `https://scratch.mit.edu/projects/<ID>/` | `https://scratch.mit.edu/projects/<ID>/embed` |
| `"turbowarp"` | `scratchId` | `https://turbowarp.org/<ID>` | `https://turbowarp.org/<ID>/embed` |

- Scratch / TurboWarp は、Scratch 公式サイトで「共有」されている作品だけが埋め込める。
- 作品ページのURLは iframe では開けないため、埋め込み専用URLを使う。
- 4.の開発ルールは自作ゲーム向けで、Scratch には適用しない。

## 4. 生徒リポジトリの開発ルール(LLM活用前提)
生徒が LLM(Cursor / Copilot / Cline 等)で開発しても画面崩れや操作競合が起きないよう、テンプレートに指示ファイルを同梱する。

### 4.1 指示ファイル(内容は同一)
| ツール | ファイル |
|---|---|
| 汎用 / Cline | `AGENTS.md` |
| Cursor | `.cursorrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |

### 4.2 制約要件
1. **画面サイズ**
   - 基準解像度は 800×600px(4:3)。
   - 親要素に合わせて比率を保ったまま全体を縮小(fit)する。
   - `body` に `overflow: hidden`。
2. **キーボード・フォーカス**
   - 矢印キーと Space では、必ず `e.preventDefault()` を呼ぶ。
   - 開始前に「画面をクリックしてスタート」画面を挟み、Canvas にフォーカスを当てる。
3. **localStorage**
   - キー名にゲームIDのプレフィックスを付ける(例: `game_invader_highscore`)。
4. **素材**
   - 画像・音声は外部URLを参照せず、`assets/` から相対パスで読み込む。
5. **コード**
   - 日本語のやさしいコメントを付ける。
   - 大規模フレームワークは使わず、Vanilla JS か p5.js など初学者向けライブラリを使う。

### 4.3 テンプレートの内容
- `index.html`: 800×600 の Canvas を含む入口。
- `style.css`: `overflow: hidden` と中央配置。
- `game.js`: `fitToWindow()`、`saveKey()`、キー入力処理、クリックしてスタート、サンプルの動作。
- `assets/`: 素材置き場(空)。

## 5. 今後のタスク
- [ ] `student-template/` を単独リポジトリにして Template repository に設定する
- [x] `src/front` を公開する GitHub Actions ワークフローを用意する
- [ ] 実機テスト(矢印キー操作時のスクロール、タブレットでの表示崩れ)
- [ ] 実測を踏まえ、起動方式(別タブ / モーダル)を最終決定する
- [ ] 実際のゲームとサムネイルの登録
