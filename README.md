# NESTON Games Hub

生徒が作ったWebゲームを集めるポータルサイト。公開ポータルはGitHub Pages、管理画面・APIはCloudflare(Pages/Workers/D1/Access)で動く。

仕様・アーキテクチャの詳細は `SPEC.md` を参照。AIエージェント向けの注意点(承認が必要な操作・コーディング規約)は `AGENTS.md` を参照。

## 構成
- `src/front/` … 公開ポータル本体(GitHub Actionsで GitHub Pages に公開)
  - `index.html` / `css/style.css` / `js/app.js` / `js/config.js`
  - `assets/thumbs/` … サムネイル画像を置く場所(管理画面でサムネイルURLに相対パス`assets/thumbs/xxx.png`を指定した場合用。4:3推奨)
- `src/admin/` … 管理画面(Cloudflare Pagesにのみデプロイ。GitHub Pagesには公開しない)
  - `index.html` / `css/admin.css` / `js/admin.js` / `js/config.js`
  - `functions/api/[[path]].js` … Pages Functions。Service Binding経由で管理APIに中継する
  - `wrangler.toml`
- `worker/front/` … 公開側API(Cloudflare Workers)。ゲーム一覧配信・コメント投稿、認証なし
- `worker/admin/` … 管理側API(Cloudflare Workers)。ゲーム編集・コメント承認。Cloudflare Accessで保護
- `worker/schema.sql` … D1データベース(`games` / `comments`)のテーブル定義
- `sample-web-game/` … 生徒がAIエージェントと一緒にゲームを作るときのルール(`AGENTS.md`)

## ゲームの追加
**管理画面から追加する**(URL・タイトル・作者・説明・サムネイルURLを入力して保存するだけ)。Scratch / TurboWarpの共有URLを入力すると、種類と作品IDを自動判定する。詳しくは「運用」節を参照。

## 起動方式
`src/front/js/app.js` の `launchMode` 定数で固定(現在は `"modal"`)。切り替える場合はコードを直接編集する:
- `"modal"` … 全画面モーダル内にiframeを動的生成(閉じると削除)
- `"tab"` … 別タブで開く(トラブルが最も少ない)

## ローカル確認
- `src/front/`・`src/admin/` は `fetch` を使うため、`python -m http.server` などで起動して開くこと。
- Workerは `worker/front/`・`worker/admin/` それぞれで `npx wrangler dev` を実行する。D1を使う機能を確認する場合は、先にローカルDBへスキーマを当てる:
  ```powershell
  npx wrangler d1 execute neston-games-hub-db --local --persist-to ../.wrangler/state --file=../schema.sql
  ```

## 初回セットアップ(まだ存在しない環境を作る場合)
```powershell
npx wrangler login

# D1データベースを作成してスキーマを当てる
cd worker
npx wrangler d1 create neston-games-hub-db
npx wrangler d1 execute neston-games-hub-db --remote --file=schema.sql
```
1. `worker/front/wrangler.toml` と `worker/admin/wrangler.toml` の `[[d1_databases]]` に、作成したD1の `database_id` を入れる。
2. 両方の `wrangler.toml` の `[vars] ALLOWED_ORIGINS` に、ポータルの公開URL(GitHub PagesのURL)と管理画面のURL(Cloudflare PagesのURL)を入れる。
3. 両方のWorkerをデプロイ(次節「デプロイ」参照)し、表示された `workers.dev` のURLを控える。
4. `src/front/js/config.js` の `apiBase` に `worker/front` のURLを入れる。`src/admin/js/config.js` の `apiBase` は空文字のままにする(Pages Functions経由で呼ぶため、変更不要)。
5. `src/admin/wrangler.toml` の `[[services]]` の `service` に、`worker/admin` のWorker名(`name`)が入っていることを確認する。
6. 管理画面(Cloudflare Pages)をデプロイし、Cloudflare Access(Zero Trust)で保護する(「管理画面の公開先・保護」を参照)。

## デプロイ
このリポジトリには4つの独立したデプロイ対象がある。**変更したものだけ**デプロイすればよい(他の3つには影響しない)。リポジトリ直下から実行する場合のコマンド:

| 対象 | コマンド | トリガー |
|---|---|---|
| `worker/front`(公開API) | `cd worker/front; npx wrangler deploy` | 手動 |
| `worker/admin`(管理API) | `cd worker/admin; npx wrangler deploy` | 手動 |
| `src/admin`(管理画面, Cloudflare Pages) | `cd src/admin; npx wrangler pages deploy . --project-name neston-games-hub-admin --commit-dirty=true` | 手動 |
| `src/front`(公開ポータル, GitHub Pages) | `git push origin main` | pushで `.github/workflows/pages.yml` が自動デプロイ(`src/front/**` 以外の変更でも全体がpushされれば動く) |

補足:
- `wrangler deploy` がCloudflare側の一時的なエラー(例: 「binding DB of type d1 failed to generate」)で失敗することがある。設定(`wrangler.toml`)が正しいことを確認した上で、少し待って再試行すると直ることが多い。
- D1のスキーマを変更した場合は、両方のWorkerが同じデータベースを参照しているため、デプロイ前に一度だけ本番DBに対して `wrangler d1 execute neston-games-hub-db --remote --command "..."` でマイグレーションを実行する。

## 運用
- コメントは**承認制**。投稿は「承認待ち」になり、管理画面の「コメント」タブ(または各ゲームの「💬 コメント」ボタン)で承認すると公開される。
- ゲームの追加・編集・非表示は管理画面から行う。表示順は投稿日時の新しい順で固定。
- ゲームのURLを入力して「ゲーム情報を取得」を押すと、Scratch/TurboWarpの作品ならそちらのAPIから、それ以外のURLなら直下の `game.json`(`sample-web-game/AGENTS.md` 参照)からタイトル・作者・サムネイルを自動入力できる。

## 管理画面の公開先・保護(Cloudflare Pages + Zero Trust)
- 管理画面URL: `https://neston-games-hub-admin.pages.dev/`
- Cloudflare Pagesプロジェクト名: `neston-games-hub-admin`(`*.pages.dev` のドメイン名はプロジェクト名で決まり、後から変更できないので注意)
- Zero Trust team名: `nestonkids`(`nestonkids.cloudflareaccess.com`)
- ログイン方法: **One-time PIN**(メールにコードが届く方式。Settings → Authentication → Login methods で有効化が必要)
- Accessポリシー: 末尾が `@nestonkids.com` のメールのみ許可
- 管理画面(Pages)と管理API(`worker/admin`)は別ドメインだが、`src/admin` がPages Functions + Service Binding経由で管理APIを同一オリジンとして中継するため、**ログインは管理画面側の1回だけ**で済む(詳しい仕組みは `SPEC.md` 2.3節)。管理API Workerの `workers.dev` URLを直接開いた場合は、そちらのAccessアプリケーションで別途ログインが必要。
