// 管理画面(Pages)と管理API(worker/admin)を同一オリジンにするための中継。
// Service Binding経由でWorkerのfetchハンドラを直接呼ぶため、Cloudflare Accessは
// 管理画面側(このPagesドメイン)の1回のログインだけで両方に届く。
export async function onRequest(context) {
  return context.env.ADMIN_API.fetch(context.request);
}
