import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, upsertCustomer, userKey } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { WINBACK_KEY, runWinback } from "@/core/winback/winback";

/** Возвратные продажи: давний покупатель получает первое сообщение ровно один раз. */
const TG = TEST_TG_ID + 93;
const KEY = userKey("telegram", String(TG));
let ctx: TenantContext;
let prev: string | null = null;
let orderId = 0;

async function cleanup() {
  const db = serviceDb();
  if (orderId) await db.from("orders").delete().eq("id", orderId);
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("user_key", KEY);
}

describe.skipIf(!liveReady)("возвратные продажи на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...t, modules: { ...t.modules, winback: true } });
    prev = await getSetting(ctx, WINBACK_KEY);
    await cleanup();
    await upsertCustomer(ctx, "telegram", String(TG), { firstName: "Вернись" });
    const { data, error } = await serviceDb()
      .from("orders")
      .insert({
        bot_id: DEMO_BOT,
        telegram_id: TG,
        user_key: KEY,
        status: "delivered",
        total: 1000,
        currency: "KZT",
        platform: "telegram",
        display_name: "Вернись",
        created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    orderId = data.id;
  });
  afterAll(async () => {
    await setSetting(ctx, WINBACK_KEY, prev ?? "");
    await cleanup();
  });

  it("первое сообщение через 30 дней, повторно — нет; ночью молчит", async () => {
    await setSetting(ctx, WINBACK_KEY, JSON.stringify({ enabled: true, days1: 30, days2: 60 }));
    const day = new Date();
    day.setUTCHours(6, 0, 0, 0); // 11:00 в Алматы
    const sent: Array<[number, string]> = [];
    const send = async (c: { telegramId: number }, text: string) => {
      if (c.telegramId === TG) sent.push([c.telegramId, text]);
      return true;
    };
    await runWinback(ctx, send, day);
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toContain("Вернись");
    expect((await getCustomer(ctx, KEY))?.state.winback).toMatchObject({
      order_id: orderId,
      step: 1,
    });
    await runWinback(ctx, send, day);
    expect(sent).toHaveLength(1);

    const night = new Date(day);
    night.setUTCHours(18, 0, 0, 0); // 23:00
    expect((await runWinback(ctx, send, night)).skipped).toBe("night");
  });
});
