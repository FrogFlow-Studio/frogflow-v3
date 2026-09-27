import { beforeEach, describe, expect, it, vi } from "vitest";

/** Маршрут Telegram: обновление сверх лимита — ответ 200, обработчик не вызывается. */
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({ options: opts }),
}));
vi.mock("@/config/env", () => ({
  env: () => ({ WEBHOOK_SECRET: "s", TELEGRAM_API_BASE: "x" }),
}));
vi.mock("@/channels/telegram/secret", () => ({ verifyTelegramWebhookHeader: () => true }));
vi.mock("@/lib/background", () => ({ runInBackground: async (t: () => Promise<void>) => t() }));
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ({ id: "b", settings: { served_by: "v2" } }),
  tenantContext: (t: unknown) => ({ tenant: t, secrets: { telegramToken: () => "t" } }),
}));
vi.mock("@/channels/telegram/dedupe", () => ({ claimTelegramUpdate: async () => true }));
let allowed = true;
vi.mock("@/channels/telegram/inbound-limit", () => ({
  telegramInboundAllowed: async () => allowed,
}));
vi.mock("@/channels/telegram/api", () => ({ telegramApi: () => ({}) }));
const handled: unknown[] = [];
vi.mock("@/channels/telegram/handle-update", () => ({
  handleTelegramUpdate: async (_c: unknown, _a: unknown, u: unknown) => {
    handled.push(u);
  },
}));

const { Route } = await import("@/routes/api/telegram.$botId");
type Post = (a: { request: Request; params: { botId: string } }) => Promise<Response>;
const post = (Route as unknown as { options: { server: { handlers: { POST: Post } } } }).options
  .server.handlers.POST;
const BOT = "11111111-1111-1111-1111-111111111111";
const call = () =>
  post({
    request: new Request("https://app.test/api/telegram/x", {
      method: "POST",
      body: JSON.stringify({ update_id: 1, message: { text: "hi" } }),
    }),
    params: { botId: BOT },
  });

beforeEach(() => {
  handled.length = 0;
});

describe("маршрут Telegram и лимит входящих", () => {
  it("сверх лимита — 200 без обработки; в пределах — обработка", async () => {
    allowed = false;
    const r = await call();
    expect(r.status).toBe(200);
    expect(handled).toEqual([]);
    allowed = true;
    await call();
    expect(handled).toHaveLength(1);
  });
});
