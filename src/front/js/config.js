// APIのURL(公開用)。`worker/front` を `wrangler deploy` したときに表示されるURLを入れる。
// 空のままなら、いいね・コメントなしで games.json だけを表示する。
// offlineDemo: true の間は、APIにつながらないとき「この端末だけに保存する試用モード」で動く。
//   本番公開の前に false にすること(訪問者に、他の人には見えないコメントが出てしまうため)。
window.HUB_CONFIG = {
  apiBase: 'https://neston-games-hub-api.neston-kids.workers.dev',
  offlineDemo: true,
};
