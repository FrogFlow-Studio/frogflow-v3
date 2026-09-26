import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID, dropDemoOrder } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey, type Customer } from "@/core/customers/customers";
import { addToCart, clearCart, listCart, priceCart } from "@/core/cart/cart";
import { completeLanguageDelivery, deliverOrder, getOrder, placeOrder } from "@/core/orders/orders";
import { cartLanguageChoices } from "@/core/cart/languages";
import { setSetting } from "@/core/settings/settings";

/**
 * Мультиязычная выдача против настоящей базы: «все языки» ×N в цене и в
 * выдаче, вопрос о языке при выдаче с закрытием заказа после ответа.
 */
const TG = TEST_TG_ID + 60;
const PROBE_NAME = "v2 langs · материал";
const COUNTRY_NAME = "Казахстан (v2 langs)";
let ctx: TenantContext;
let customer: Customer;
let productId = "";
const orders: number[] = [];
const sent: string[] = [];
const sender = async (
  item: { name_snapshot: string },
  materials: Array<{ url: string | null }>,
) => {
  sent.push(`${item.name_snapshot}: ${materials.map((m) => m.url).join(",")}`);
  return "sent" as const;
};

async function cleanup() {
  const db = serviceDb();
  for (const id of orders) await dropDemoOrder(id);
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", TG));
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE_NAME);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY_NAME);
}

describe.skipIf(!liveReady)("выдача на нескольких языках", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: {
        ...tenant.modules,
        multi_language: true,
        stock: false,
        loyalty: false,
        referral: false,
      },
    });
    await cleanup();
    const { data: p, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PROBE_NAME,
        price: 1000,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
        file_url: "https://example.com/ru.pdf",
        file_url_kz: "https://example.com/kk.pdf",
      })
      .select("id")
      .single();
    if (error || !p) throw new Error(`seed product: ${error?.message}`);
    productId = p.id;
    await ctx.db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY_NAME,
      instructions: "тест",
      currency: "KZT",
      is_active: true,
      sort_order: 98,
    });
    await setSetting(ctx, "delivery_lang_timing", "before");
    customer = await upsertCustomer(ctx, "telegram", TG, { firstName: "Языки" });
  });
  afterAll(async () => {
    await setSetting(ctx, "delivery_lang_timing", "during");
    await cleanup();
  });

  it("«все языки»: цена ×2 по числу языков товара, выдача обоих файлов с подписью языка", async () => {
    expect(await addToCart(ctx, customer, productId)).toBe("ok");
    expect(await cartLanguageChoices(ctx, customer)).toEqual(["ru", "kk"]);
    const items = await listCart(ctx, customer);
    expect((await priceCart(ctx, items, "KZ")).total).toBe(1000);
    expect((await priceCart(ctx, items, "KZ", { deliveryLang: "all" })).total).toBe(2000);
    expect((await priceCart(ctx, items, "KZ", { deliveryLang: "kk" })).total).toBe(1000);

    const r = await placeOrder(ctx, customer, "KZ", { deliveryLang: "all" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    orders.push(r.order.id);
    expect(Number(r.order.total)).toBe(2000);
    expect(r.order.delivery_lang_choice).toBe("all");

    sent.length = 0;
    const d = await deliverOrder(ctx, r.order.id, sender, { lang: "ru" });
    expect(d.failed).toBe(0);
    expect(d.pending).toBe(0);
    expect(sent).toEqual([
      `${PROBE_NAME} (Русский): https://example.com/ru.pdf`,
      `${PROBE_NAME} (Қазақша): https://example.com/kk.pdf`,
    ]);
    const o = await getOrder(ctx, r.order.id);
    expect(o?.status).toBe("delivered");
    expect(o?.order_items[0]?.delivered_language).toBe("ru,kk");
  });

  it("без выбора: вопрос о языке при выдаче, заказ закрывается после ответа покупателя", async () => {
    await clearCart(ctx, customer);
    expect(await addToCart(ctx, customer, productId)).toBe("ok");
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    orders.push(r.order.id);
    expect(Number(r.order.total)).toBe(1000);

    const asked: string[] = [];
    sent.length = 0;
    const d = await deliverOrder(ctx, r.order.id, sender, {
      lang: "ru",
      ask: async (item, langs) => {
        asked.push(`${item.name_snapshot}: ${langs.join("+")}`);
        return true;
      },
    });
    expect(d.pending).toBe(1);
    expect(d.sent).toBe(0);
    expect(asked).toEqual([`${PROBE_NAME}: ru+kk`]);
    expect((await getOrder(ctx, r.order.id))?.status).toBe("delivering");

    const itemId = r.order.order_items[0]!.id;
    const pick = await completeLanguageDelivery(
      ctx,
      { orderId: r.order.id, itemId, lang: "kk", telegramId: TG },
      sender,
    );
    expect(pick.status).toBe("sent");
    if (pick.status === "sent") expect(pick.completed).toBe(true);
    expect(sent).toEqual([`${PROBE_NAME}: https://example.com/kk.pdf`]);
    expect((await getOrder(ctx, r.order.id))?.status).toBe("delivered");
    // Повторный тап по тому же языку — файл уже отправлен.
    const again = await completeLanguageDelivery(
      ctx,
      { orderId: r.order.id, itemId, lang: "kk", telegramId: TG },
      sender,
    );
    expect(again.status).toBe("already");
  });

  it("повторная выдача идёт на уже выбранных языках без переспроса", async () => {
    const id = orders[1]!;
    await ctx.db.from("orders").update({ status: "paid" }).eq("id", id);
    sent.length = 0;
    const d = await deliverOrder(ctx, id, sender, {
      lang: "ru",
      ask: async () => {
        throw new Error("не должен спрашивать");
      },
    });
    expect(d.pending).toBe(0);
    expect(d.failed).toBe(0);
    expect(sent).toEqual([`${PROBE_NAME}: https://example.com/kk.pdf`]);
  });
});
