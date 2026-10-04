import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

type Reply =
  | { ok: true; status: number }
  | { ok: false; error: string; timedOut?: boolean; notSent?: boolean };
let reply: Reply = { ok: true, status: 200 };
vi.mock("@/core/crm/webhook", async (orig) => ({
  ...(await orig<typeof import("@/core/crm/webhook")>()),
  postPinned: vi.fn(async () => reply),
}));

const { postWebhook } = await import("./senders.server");
const { loadCrmLog } = await import("@/core/crm/log");

const URL = "https://crm.example.kz/hook";
const body = JSON.stringify({ event: "order.payment", event_id: "ev-1", order: { id: 42 } });
let ctx: TenantContext;
beforeEach(async () => {
  reply = { ok: true, status: 200 };
  ctx = {
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
    tenant: { id: "11111111-1111-1111-1111-111111111111" },
  } as unknown as TenantContext;
  await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: "crm_webhook",
    value: JSON.stringify({ url: URL, secret: "SEC", events: ["payment"] }),
  });
});

describe("postWebhook пишет журнал доставки", () => {
  it("принято, 500, таймаут, обрыв — каждая отправка оставляет запись", async () => {
    expect(await postWebhook(ctx, URL, body)).toEqual({ ok: true, status: 200 });
    reply = { ok: true, status: 500 };
    expect(await postWebhook(ctx, URL, body)).toMatchObject({
      ok: false,
      error: "HTTP 500",
      status: 500,
    });
    reply = { ok: false, error: "aborted", timedOut: true };
    await postWebhook(ctx, URL, body);
    reply = { ok: false, error: "ECONNRESET" };
    await postWebhook(ctx, URL, body);
    const log = await loadCrmLog(ctx);
    expect(log.map((e) => [e.outcome, e.status]).reverse()).toEqual([
      ["ok", 200],
      ["http", 500],
      ["timeout", null],
      ["network", null],
    ]);
    expect(log.every((e) => e.orderId === 42 && e.eventId === "ev-1")).toBe(true);
    expect(JSON.stringify(log)).not.toContain("SEC");
    expect(JSON.stringify(log)).not.toContain("crm.example.kz");
  });

  it("адрес недоступен (ENOTFOUND): в журнале «не ушло», очередь повторит сама — не «обрыв»", async () => {
    reply = { ok: false, error: "getaddrinfo ENOTFOUND", notSent: true };
    expect(await postWebhook(ctx, URL, body)).toMatchObject({ ok: false, permanent: false });
    expect((await loadCrmLog(ctx))[0]!.outcome).toBe("notSent");
  });

  it("запрещённый адрес не уходит в сеть, но виден в журнале", async () => {
    const { postPinned } = await import("@/core/crm/webhook");
    vi.mocked(postPinned).mockClear();
    const r = await postWebhook(ctx, "https://10.0.0.1/hook", body);
    expect(r.ok).toBe(false);
    expect(postPinned).not.toHaveBeenCalled();
    expect((await loadCrmLog(ctx))[0]!.outcome).toBe("blocked");
  });
});
