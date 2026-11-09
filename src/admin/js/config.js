// APIのURL(管理用)。`worker/admin` を `wrangler deploy` したときに表示されるURLを入れる。
// このAPI自体がCloudflare Access(Zero Trust)で保護されている前提。
window.HUB_CONFIG = {
  apiBase: 'https://neston-games-hub-admin-api.neston-kids.workers.dev',
};
