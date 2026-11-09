# NESTON Games Hub

生徒が作ったWebゲームを集めるポータルサイト（GitHub Pages）。

## 構成
仕様は `SPEC.md` を参照。ソースは `src/` 以下で、公開ポータルと管理画面でディレクトリを分けている(管理画面がGitHub Pages側に漏れないようにするため)。

- `src/front/` … 公開ポータル本体(GitHub Actionsで GitHub Pages に公開)
  - `index.html` / `css/style.css` / `js/app.js` / `js/config.js`
  - `games.json` … 作品リスト。ゲームを追加するときはここに1件足す
  - `assets/thumbs/` … サムネイル画像（4:3推奨）
- `src/admin/` … 管理画面(Cloudflare Pagesにのみデプロイ。GitHub Pagesには公開しない)
  - `index.html` / `css/admin.css` / `js/admin.js` / `js/config.js`(front側と別管理。値を変えたら両方直す)
- `src/student-template/` … 生徒用スターターテンプレート（別リポジトリとして「Template repository」に設定する）

## ゲームの追加
`games.json` の `games` に追加:
```json
{ "id": "invader", "title": "...", "author": "...", "description": "...",
  "thumbnail": "assets/thumbs/invader.png", "url": "https://<org>.github.io/<repo>/" }
```

Scratch / TurboWarp の作品は `url` の代わりに `"type": "scratch"`（または `"turbowarp"`）と `"scratchId": "作品ID"` を書く。共有済みの作品のみ表示できる。

## 起動方式
`games.json` の `config.launchMode` で切替:
- `"modal"` … 全画面モーダル内にiframeを動的生成（閉じると削除）
- `"tab"` … 別タブで開く（トラブルが最も少ない）

## ローカル確認
`fetch` を使うため、`python -m http.server` などを実行して開くこと。ポータルは `src/front/` で、管理画面は `src/admin/` でそれぞれ起動する。

## いいね・コメント・管理画面(Cloudflare)
`worker/` が API(Cloudflare Workers + D1)。ポータルと管理画面はこの API を呼ぶ。`js/config.js` の `apiBase` が空なら従来どおり `games.json` だけで動く(front側・admin側それぞれの `js/config.js` を直すこと)。

### セットアップ(初回のみ。`worker/` で実行)
```powershell
npx wrangler login
npx wrangler d1 execute neston-hub-db --remote --file=schema.sql   # テーブル作成
npx wrangler secret put ADMIN_PASSWORD   # 管理画面のパスワード
npx wrangler secret put TOKEN_SECRET     # 32文字以上のランダムな文字列
npx wrangler deploy                      # 表示された workers.dev のURLを控える
```
1. `wrangler.toml` の `ALLOWED_ORIGINS` に、ポータルの公開URL(`https://<org>.github.io` など、パスなし)と管理画面のURL(Cloudflare PagesのURL)を入れて再度 `deploy`
2. `src/front/js/config.js` と `src/admin/js/config.js` の両方の `apiBase` に workers.dev のURLを入れて、ポータル・管理画面をそれぞれ公開(詳しくは後述の「管理画面の公開先・保護」を参照)
3. 管理画面(Cloudflare PagesのURL)を開き、ログイン →「ゲーム」タブの「games.json から取り込む」

### 運用
- コメントは**承認制**。投稿は「承認待ち」になり、管理画面の「コメント」タブで承認すると公開される
- ゲームの追加・編集・非表示・並び替えは管理画面から(API利用時、表示の元データは D1。`games.json` は初回取り込みとAPI停止時の予備)
- パスワード変更は `npx wrangler secret put ADMIN_PASSWORD` をやり直す

### 公開の全体像
- **公開ポータル**: `src/front/` を GitHub Actions(`.github/workflows/pages.yml`)で GitHub Pages に公開。`src/front/**` が変わるたびに自動デプロイされる(誰でも閲覧可・保護なし)
- **管理画面**: `src/admin/` を Cloudflare Pages にデプロイし、Cloudflare Access(Zero Trust)で保護。管理画面自体がGitHub Pages側には一切含まれないため、公開URLから推測されても到達できない

### 管理画面の公開先・保護(Cloudflare Pages + Zero Trust)
- 管理画面URL: `https://neston-games-hub-admin.pages.dev/`
- Cloudflare Pagesプロジェクト名: `neston-games-hub-admin`(`*.pages.dev` のドメイン名はプロジェクト名で決まり、後から変更できないので注意)
- Zero Trust team名: `nestonkids`(`nestonkids.cloudflareaccess.com`)
- ログイン方法: **One-time PIN**(メールにコードが届く方式。Settings → Authentication → Login methods で有効化が必要)
- Accessポリシー: `末尾が次のメール` = `@nestonkids.com` のみ許可

デプロイ・更新コマンド(リポジトリ直下で実行):
```powershell
npx wrangler pages deploy src/admin --project-name=neston-games-hub-admin
```
`src/admin/` を更新したら、このコマンドで再デプロイすること。

Worker側の `worker/wrangler.toml` の `ALLOWED_ORIGINS` にも、このCloudflare PagesのURLを含めておくこと(CORSで必要)。
