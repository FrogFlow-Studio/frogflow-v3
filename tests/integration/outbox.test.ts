import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import {
  countUndelivered,
  dismissOutbox,
  enqueueOutbox,
  listUndelivered,
  OUTBOX_PREFIX,
  processOutbox,
  retryOutbox,
  sendOrEnqueue,
  type OutboxSender,
} from "@/core/outbox/outbox";

/**
 * Очередь исходящих на демо-клиенте: отказ кладёт строку в zernio_logs,
 * крон повторяет с растущей паузой, «заблокировал бота» — сразу в
 * «не доставлено», продавец может повторить или скрыть.
 */
let ctx: TenantContext;
const startedAt = new Date().toISOString();
const msg = (text: string) => ({
  kind: "customer_notice",
  target: { channel: "telegram" as const, chatId: "990000001" },
  text,
  audience: "customer" as const,
});
const failing: OutboxSender = async () => ({ ok: false, error: "Too Many Requests" });
const blocked: OutboxSender = async () => ({ ok: false, error: "Forbidden: bot was blocked" });
const okSender: OutboxSender = async () => ({ ok: true });

async function cleanup() {
  await serviceDb()
    .from("zernio_logs")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .gte("created_at", startedAt);
}

describe.skipIf(!liveReady)("outbox: повторы исходящих", () => {
  beforeAll(async () => {
    ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    await cleanup();
  });
  afterAll(cleanup);

  it("отказ ставит в очередь на минуту, повтор растит паузу, успех закрывает", async () => {
    const now = new Date();
    expect(await sendOrEnqueue(ctx, msg("проба 1"), failing)).toBe(false);
    let rows = await listUndelivered(ctx);
    const row = rows.find((r) => r.text === "проба 1")!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(Date.parse(row.nextAt!) - now.getTime()).toBeGreaterThan(50_000);

    // Рано — крон не трогает.
    let r = await processOutbox(ctx, failing, now);
    expect(r.tried).toBe(0);
    // Через две минуты — вторая попытка, пауза уже пять минут.
    r = await processOutbox(ctx, failing, new Date(now.getTime() + 2 * 60_000));
    expect(r).toMatchObject({ tried: 1, requeued: 1, sent: 0, dead: 0 });
    rows = await listUndelivered(ctx);
    const again = rows.find((r) => r.text === "проба 1")!;
    expect(again.attempts).toBe(2);
    expect(again.lastError).toBe("Too Many Requests");
    expect(Date.parse(again.nextAt!) - (now.getTime() + 2 * 60_000)).toBeGreaterThan(4 * 60_000);

    r = await processOutbox(ctx, okSender, new Date(now.getTime() + 10 * 60_000));
    expect(r.sent).toBe(1);
    expect((await listUndelivered(ctx)).some((r) => r.text === "проба 1")).toBe(false);
  });

  it("заблокировавший бота покупатель — сразу «не доставлено», повтор и скрытие работают", async () => {
    expect(await sendOrEnqueue(ctx, msg("проба 2"), blocked)).toBe(false);
    const dead = (await listUndelivered(ctx)).find((r) => r.text === "проба 2")!;
    expect(dead.status).toBe("dead");
    expect(await countUndelivered(ctx)).toBeGreaterThanOrEqual(1);

    expect(await retryOutbox(ctx, dead.id)).toBe(true);
    const queued = (await listUndelivered(ctx)).find((r) => r.id === dead.id)!;
    expect(queued.status).toBe("queued");
    expect(queued.attempts).toBe(0);

    expect(await dismissOutbox(ctx, dead.id)).toBe(true);
    expect((await listUndelivered(ctx)).some((r) => r.id === dead.id)).toBe(false);
  });

  it("постановка без отказа — ближайший запуск крона", async () => {
    await enqueueOutbox(ctx, msg("проба 3"), null);
    const r = await processOutbox(ctx, okSender);
    expect(r.sent).toBeGreaterThanOrEqual(1);
  });
});
