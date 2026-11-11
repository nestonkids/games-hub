// APIのURL(管理用)。`worker/admin` を `wrangler deploy` したときに表示されるURLを入れる。
// このAPI自体がCloudflare Access(Zero Trust)で保護されている前提。
window.HUB_CONFIG = {
  // 管理画面と同一オリジンのPages Functions経由でAPIを呼ぶ(Service Binding中継)。
  // これによりCloudflare Accessのログインが管理画面1回で済む。
  apiBase: '',
};
