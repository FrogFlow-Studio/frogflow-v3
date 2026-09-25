import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { retryStuckEvents, type DispatchOutcome } from "@/channels/zernio/dispatch.server";

/**
 * Добор зависших событий Zernio: строка `received` старше трёх минут
 * прогоняется обработчиком и получает итог; свежая — не трогается.
 * Обработчик подменён: суть проверки — выборка и статусы, а не тело.
 */
const PREFIX = "probe-stuck:";
let ctx: TenantContext;

async function cleanup() {
  await serviceDb()
    .from("zernio_logs")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .like("event_id", `${PREFIX}%`);
}

async function insertReceived(id: string, ageMs: number) {
  const { error } = await serviceDb()
    .from("zernio_logs")
    .insert({
      bot_id: DEMO_BOT,
      event_id: `${PREFIX}${id}`,
      event_type: "message.received",
      status: "received",
      payload: { id: `${PREFIX}${id}`, event: "message.received", message: { text: id } },
      created_at: new Date(Date.now() - ageMs).toISOString(),
    });
  if (error) throw new Error(error.message);
}

describe.skipIf(!liveReady)("добор зависших событий Zernio", () => {
  beforeAll(async () => {
    ctx = tenantContext(await requireTenant({ by: "id", value: DEMO_BOT }));
    await cleanup();
  });
  afterAll(cleanup);

  it("берёт только старые received, прогоняет и пишет итог", async () => {
    await insertReceived("old", 5 * 60_000);
    await insertReceived("fresh", 30_000);
    const seen: string[] = [];
    const fake = async (_c: TenantContext, eventId: string): Promise<DispatchOutcome> => {
      seen.push(eventId);
      return { status: "processed", note: "ок" };
    };
    const r = await retryStuckEvents(ctx, new Date(), fake);
    expect(r).toMatchObject({ found: 1, processed: 1, failed: 0 });
    expect(seen).toEqual([`${PREFIX}old`]);

    const { data } = await ctx.db
      .from("zernio_logs")
      .select("event_id, status, error_message")
      .like("event_id", `${PREFIX}%`)
      .order("event_id");
    expect(data).toEqual([
      { event_id: `${PREFIX}fresh`, status: "received", error_message: null },
      { event_id: `${PREFIX}old`, status: "processed", error_message: "добор: ок" },
    ]);

    // Второй проход ничего не находит: строка уже закрыта.
    expect((await retryStuckEvents(ctx, new Date(), fake)).found).toBe(0);
  });
});
