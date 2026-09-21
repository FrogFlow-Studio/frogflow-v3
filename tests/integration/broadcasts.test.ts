import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey } from "@/core/customers/customers";
import {
  cancelBroadcast,
  createBroadcast,
  listBroadcasts,
  processBroadcastBatch,
  resolveAudience,
} from "@/core/broadcasts/broadcasts";
import { sendCartReminders } from "@/core/reminders/cart";

// Свои id, а не TEST_TG_ID: vitest гоняет файлы параллельно, и уборка этого
// теста не должна сносить покупателя, с которым в это время работает shop-flow.
const PROBE_TG_ID = TEST_TG_ID + 10;
const OTHER_TG_ID = TEST_TG_ID + 11; // второй синтетический покупатель, «ещё не покупал»
const MARK = "v2 probe · рассылка";
let ctx: TenantContext;

async function cleanup() {
  const db = serviceDb();
  const { data: bs } = await db
    .from("broadcasts")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .like("message_text", `${MARK}%`);
  for (const b of bs ?? []) {
    await db.from("broadcast_recipients").delete().eq("broadcast_id", b.id);
    await db.from("broadcasts").delete().eq("id", b.id);
  }
  await db
    .from("cart_items")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("telegram_id", [PROBE_TG_ID, OTHER_TG_ID]);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .in("user_key", [userKey("telegram", PROBE_TG_ID), userKey("telegram", OTHER_TG_ID)]);
}

describe.skipIf(!liveReady)("рассылки и напоминания на демо-клиенте", () => {
  beforeAll(async () => {
    // Модули включаем в памяти, а не в bots.modules: файл shop-flow параллельно
    // переключает свои флаги и восстанавливает снимок — записи бы затирали друг друга.
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: { ...tenant.modules, broadcasts: true, cart_reminder: true },
    });
    await cleanup();
    await upsertCustomer(ctx, "telegram", PROBE_TG_ID, { firstName: "Probe" });
    await upsertCustomer(ctx, "telegram", OTHER_TG_ID, { firstName: "Probe2" });
  });
  afterAll(cleanup);

  it("аудитория «всем» видит обоих пробных покупателей, «покупатели» — никого из них", async () => {
    const all = await resolveAudience(ctx, "all");
    expect(all).toContain(PROBE_TG_ID);
    expect(all).toContain(OTHER_TG_ID);
    const buyers = await resolveAudience(ctx, "buyers");
    expect(buyers).not.toContain(PROBE_TG_ID);
    const nonBuyers = await resolveAudience(ctx, "non_buyers");
    expect(nonBuyers).toContain(PROBE_TG_ID);
  });

  it("создаёт рассылку, отправляет пакет и закрывает её; заблокировавших считает отдельно", async () => {
    const r = await createBroadcast(ctx, {
      text: `${MARK} привет`,
      photoKeys: [],
      productIds: [],
      showCatalog: true,
      audience: "all",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.broadcast.total_count).toBeGreaterThanOrEqual(2);

    // Вторую параллельно создать нельзя.
    const busy = await createBroadcast(ctx, {
      text: `${MARK} два`,
      photoKeys: [],
      productIds: [],
      showCatalog: false,
      audience: "all",
    });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.reason).toBe("busy");

    const delivered: number[] = [];
    let done = false;
    let sent = 0;
    let blocked = 0;
    for (let i = 0; i < 20 && !done; i++) {
      const b = await processBroadcastBatch(ctx, async (id) => {
        if (id === OTHER_TG_ID) throw new Error("Forbidden: bot was blocked by the user");
        delivered.push(id);
      });
      done = b.done;
      sent += b.sent;
      blocked += b.blocked;
    }
    expect(done).toBe(true);
    expect(delivered).toContain(PROBE_TG_ID);
    expect(blocked).toBeGreaterThanOrEqual(1);

    const { data: row } = await ctx.db
      .from("broadcasts")
      .select("*")
      .eq("id", r.broadcast.id)
      .single();
    expect(row?.status).toBe("completed");
    expect(row?.sent_count).toBe(sent);
    expect(row?.blocked_count).toBe(blocked);
    const { data: rec } = await ctx.db
      .from("broadcast_recipients")
      .select("status")
      .eq("broadcast_id", r.broadcast.id)
      .eq("telegram_id", OTHER_TG_ID)
      .single();
    expect(rec?.status).toBe("blocked");
    expect((await listBroadcasts(ctx)).some((b) => b.id === r.broadcast.id)).toBe(true);
  });

  it("отмена останавливает очередь", async () => {
    const r = await createBroadcast(ctx, {
      text: `${MARK} отмена`,
      photoKeys: [],
      productIds: [],
      showCatalog: false,
      audience: "all",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await cancelBroadcast(ctx, r.broadcast.id)).toBe(true);
    expect(await cancelBroadcast(ctx, r.broadcast.id)).toBe(false);
    const b = await processBroadcastBatch(ctx, async () => {
      throw new Error("не должно вызываться");
    });
    expect(b.broadcastId).toBeNull();
    const { data: row } = await ctx.db
      .from("broadcasts")
      .select("status")
      .eq("id", r.broadcast.id)
      .single();
    expect(row?.status).toBe("cancelled");
  });

  it("напоминание о корзине уходит один раз и только после порога", async () => {
    const { data: product } = await ctx.db
      .from("products")
      .select("id")
      .eq("bot_id", DEMO_BOT)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!product) return; // у демо-клиента нет товаров — нечего класть в корзину
    const old = new Date(Date.now() - 10 * 3600_000).toISOString();
    await serviceDb()
      .from("cart_items")
      .insert({
        bot_id: DEMO_BOT,
        telegram_id: PROBE_TG_ID,
        user_key: userKey("telegram", PROBE_TG_ID),
        product_id: product.id,
        quantity: 1,
        created_at: old,
      });
    const { setSetting } = await import("@/core/settings/settings");
    const prev = await (
      await import("@/core/settings/settings")
    ).getSetting(ctx, "cart_reminder_hours");
    await setSetting(ctx, "cart_reminder_hours", "6");
    try {
      const got: number[] = [];
      const r1 = await sendCartReminders(ctx, async (t) => {
        got.push(t.telegramId);
        return true;
      });
      expect(got).toContain(PROBE_TG_ID);
      expect(r1.sent).toBeGreaterThanOrEqual(1);
      const got2: number[] = [];
      await sendCartReminders(ctx, async (t) => {
        got2.push(t.telegramId);
        return true;
      });
      expect(got2).not.toContain(PROBE_TG_ID);
    } finally {
      await setSetting(ctx, "cart_reminder_hours", prev ?? "");
    }
  });
});
