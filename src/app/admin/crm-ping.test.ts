import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

type Reply =
  | { ok: true; status: number }
  | { ok: false; error: string; timedOut?: boolean; notSent?: boolean };
let reply: Reply = { ok: true, status: 200 };
const sent: Array<{ headers: Record<string, string>; body: string }> = [];
vi.mock("@/core/crm/webhook", async (orig) => ({
  ...(await orig<typeof import("@/core/crm/webhook")>()),
  postPinned: vi.fn(async (_u: string, headers: Record<string, string>, body: string) => {
    sent.push({ headers, body });
    return reply;
  }),
}));

const { sendCrmPing } = await import("./crm.server");
const { signBody } = await import("@/core/crm/webhook");
const { loadCrmLog } = await import("@/core/crm/log");

let ctx: TenantContext;
beforeEach(async () => {
  reply = { ok: true, status: 200 };
  sent.length = 0;
  ctx = {
    db: fakeDb({ unique: { app_settings: [["bot_id", "key"]] } }),
    tenant: { id: "11111111-1111-1111-1111-111111111111" },
  } as unknown as TenantContext;
  await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: "crm_webhook",
    value: JSON.stringify({ url: "https://crm.example.kz/hook", secret: "SEC", events: [] }),
  });
});

const T0 = new Date("2026-10-04T10:00:00Z");

describe("«Проверить вебхук»", () => {
  it("ping дошёл: подпись та же, что у настоящих событий, ответ виден и в журнале", async () => {
    const r = await sendCrmPing(ctx, T0);
    expect(r).toEqual({ ok: true, status: 200 });
    const { headers, body } = sent[0]!;
    expect(headers["x-frogflow-event"]).toBe("ping");
    expect(headers["x-frogflow-signature"]).toBe(signBody(body, "SEC"));
    const b = JSON.parse(body) as { event: string; event_id: string };
    expect(b.event).toBe("ping");
    expect(b.event_id).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await loadCrmLog(ctx);
    expect([row!.event, row!.outcome, row!.status, row!.eventId]).toEqual([
      "ping",
      "ok",
      200,
      b.event_id,
    ]);
  });

  it("500 и таймаут: продавец видит причину", async () => {
    reply = { ok: true, status: 500 };
    const r500 = await sendCrmPing(ctx, T0);
    expect(r500).toMatchObject({ ok: false, error: "HTTP 500", status: 500 });
    reply = { ok: false, error: "aborted", timedOut: true };
    const rt = await sendCrmPing(ctx, new Date(T0.getTime() + 11_000));
    expect(rt.ok).toBe(false);
    expect((await loadCrmLog(ctx))[0]!.outcome).toBe("timeout");
  });

  it("не чаще раза в 10 секунд; две кнопки разом — уйдёт одна", async () => {
    await sendCrmPing(ctx, T0);
    await expect(sendCrmPing(ctx, new Date(T0.getTime() + 5_000))).rejects.toMatchObject({
      key: "err.admin.crmPingWait",
    });
    expect(sent).toHaveLength(1);
    await expect(sendCrmPing(ctx, new Date(T0.getTime() + 10_001))).resolves.toMatchObject({
      ok: true,
    });
    const t1 = new Date(T0.getTime() + 60_000);
    const both = await Promise.allSettled([sendCrmPing(ctx, t1), sendCrmPing(ctx, t1)]);
    expect(both.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(sent).toHaveLength(3);
  });

  it("адреса нет — просьба сначала сохранить, в сеть ничего не уходит", async () => {
    await ctx.db.from("app_settings").update({ value: "" }).eq("key", "crm_webhook");
    await expect(sendCrmPing(ctx, T0)).rejects.toMatchObject({ key: "err.admin.crmSaveFirst" });
    expect(sent).toHaveLength(0);
  });
});
