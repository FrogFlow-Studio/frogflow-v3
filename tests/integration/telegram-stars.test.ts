import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import { starsPayload } from "@/core/payments/stars";
import type { TelegramApi } from "@/channels/telegram/api";

/**
 * Оплата Stars целиком, с подменённым Telegram: проверка перед оплатой
 * пропускает свой заказ с верной суммой и отказывает чужому, успешная оплата
 * переводит заказ в «оплачен» и запускает выдачу.
 */
const TG = TEST_TG_ID + 97;
let ctx: TenantContext;
let prevRate: string | null = null;
let orderId = 0;
const calls: Array<[string, Record<string, unknown>]> = [];
const api: TelegramApi = {
  call: async (method: string, payload: unknown = {}) => {
    calls.push([method, payload as Record<string, unknown>]);
    return { ok: true, result: {} as never };
  },
  fileUrl: () => "",
} as unknown as TelegramApi;

async function cleanup() {
  const db = serviceDb();
  if (orderId) {
    await db
      .from("zernio_logs")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .like("event_id", `order:${orderId}:%`);
    await db.from("order_items").delete().eq("order_id", orderId);
    await db.from("orders").delete().eq("id", orderId);
  }
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
}

describe.skipIf(!liveReady)("Telegram Stars на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...t,
      status: "active",
      modules: { ...t.modules, telegram_stars: true, multi_currency: false },
    });
    prevRate = await getSetting(ctx, "stars_rate");
    await setSetting(ctx, "stars_rate", "10");
    const { data, error } = await serviceDb()
      .from("orders")
      .insert({
        bot_id: DEMO_BOT,
        telegram_id: TG,
        user_key: `tg_${TG}`,
        status: "awaiting_payment",
        total: 1005,
        currency: "KZT",
        platform: "telegram",
        display_name: "Звездочёт",
        fulfillment_kind: "digital",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    orderId = data.id;
    const { error: itemErr } = await serviceDb().from("order_items").insert({
      bot_id: DEMO_BOT,
      order_id: orderId,
      name_snapshot: "Stars · материал",
      quantity: 1,
      price_snapshot: 1005,
      file_url_snapshot: "https://example.com/stars.pdf",
    });
    if (itemErr) throw new Error(`order_items: ${itemErr.message}`);
  });
  afterAll(async () => {
    await setSetting(ctx, "stars_rate", prevRate ?? "");
    await cleanup();
  });

  it("проверка перед оплатой: своя сумма — да, чужая сумма и чужой покупатель — нет", async () => {
    const q = (id: string, from: number, amount: number) => ({
      pre_checkout_query: {
        id,
        from: { id: from },
        currency: "XTR",
        total_amount: amount,
        invoice_payload: starsPayload(orderId),
      },
    });
    await handleTelegramUpdate(ctx, api, q("ok", TG, 101));
    await handleTelegramUpdate(ctx, api, q("wrong-sum", TG, 100));
    await handleTelegramUpdate(ctx, api, q("stranger", TG + 1, 101));
    const answers = calls
      .filter(([m]) => m === "answerPreCheckoutQuery")
      .map(([, p]) => [p.pre_checkout_query_id, p.ok]);
    expect(answers).toEqual([
      ["ok", true],
      ["wrong-sum", false],
      ["stranger", false],
    ]);
  });

  it("успешная оплата — заказ оплачен и выдан, повтор не выдаёт второй раз", async () => {
    const paid = {
      message: {
        chat: { id: TG, type: "private" },
        from: { id: TG },
        successful_payment: {
          currency: "XTR",
          total_amount: 101,
          invoice_payload: starsPayload(orderId),
          telegram_payment_charge_id: "charge-1",
        },
      },
    };
    await handleTelegramUpdate(ctx, api, paid);
    const { data } = await serviceDb()
      .from("orders")
      .select("status, admin_note")
      .eq("id", orderId)
      .single();
    expect(data?.status).toBe("delivered");
    expect(data?.admin_note ?? "").toContain("Telegram Stars");
    const links = calls.filter(
      ([m, p]) => m === "sendMessage" && String(p.text).includes("stars.pdf"),
    );
    expect(links).toHaveLength(1);
    await handleTelegramUpdate(ctx, api, paid);
    expect(
      calls.filter(([m, p]) => m === "sendMessage" && String(p.text).includes("stars.pdf")),
    ).toHaveLength(1);
  });
});
