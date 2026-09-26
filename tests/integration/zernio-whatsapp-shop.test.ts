import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, dropDemoOrder } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, syntheticTelegramId, userKey } from "@/core/customers/customers";
import { getOrder } from "@/core/orders/orders";
import { handleZernioMessage } from "@/channels/zernio/handle-message";
import type { ZernioTransport } from "@/channels/zernio/api.server";

/** Магазин в WhatsApp: те же шаги, что в Direct, но выбор — списками, а не цифрами. */
const PHONE = "77000009201";
const KEY = userKey("whatsapp", PHONE);
const TG = syntheticTelegramId(KEY);
const PROBE_NAME = "Проба WhatsApp v2";
const COUNTRY_NAME = "Казахстан (v2 whatsapp)";
let ctx: TenantContext;
let productId = "";
let orderId = 0;

type Sent = { text: string; buttons?: string[]; list?: ListShape };
type ListShape = {
  type: string;
  action: {
    button: string;
    sections: Array<{ title: string; rows: Array<{ id: string; title: string }> }>;
  };
};
const sent: Sent[] = [];
const fake: ZernioTransport = {
  send: async (_c, _a, text, opts) => {
    sent.push({
      text,
      buttons: opts?.buttons?.map((b) => b.title),
      list: opts?.interactive as ListShape | undefined,
    });
    return { ok: true };
  },
  tail: async () => [],
};
const last = () => sent[sent.length - 1]!;
const rows = (l?: ListShape) => (l?.action.sections ?? []).flatMap((s) => s.rows);

function event(id: string, body: Record<string, unknown>) {
  return {
    id,
    event: "message.received",
    account: { accountId: "acc-demo-wa", platform: "whatsapp" },
    message: {
      conversationId: "conv-wa-shop",
      sender: { id: PHONE, name: "Проба WhatsApp", phoneNumber: `+${PHONE}` },
      direction: "incoming",
      ...body,
    },
  };
}
const text = (id: string, t: string) => event(id, { text: t });
const tapList = (id: string, rowId: string) => ({
  ...event(id, { text: null }),
  metadata: { interactiveType: "list_reply", interactiveId: rowId },
});

async function cleanup() {
  const db = serviceDb();
  // Все заказы пробного покупателя: сценарий заводит больше одного.
  const { data: own } = await db
    .from("orders")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", KEY);
  for (const o of own ?? []) await dropDemoOrder(o.id);
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("user_key", KEY);
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE_NAME);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY_NAME);
}

describe.skipIf(!liveReady)("магазин в WhatsApp списками на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: {
        ...tenant.modules,
        whatsapp: true,
        wa_shop: true,
        manager_chat: false,
        stock: false,
      },
    });
    await cleanup();
    // Почта платформы «готова»: WhatsApp предлагает почту с кнопкой «Без почты».
    fake.mailReady = () => true;
    const { data: p, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PROBE_NAME,
        description: "тест WhatsApp v2",
        price: 2500,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
        file_url: "https://example.com/material.pdf",
      })
      .select("id")
      .single();
    if (error || !p) throw new Error(`seed product: ${error?.message}`);
    productId = p.id;
    const { error: mErr } = await ctx.db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY_NAME,
      instructions: "Kaspi: тестовые реквизиты WhatsApp",
      currency: "KZT",
      is_active: true,
      sort_order: 99,
    });
    if (mErr) throw new Error(`seed method: ${mErr.message}`);
  });
  afterAll(cleanup);

  it("первый контакт: выбор языка списком, ответ строкой STEP:<n>", async () => {
    const r = await handleZernioMessage(ctx, text("w-1", "Здравствуйте"), fake);
    expect(r.status).toBe("processed");
    expect(last().list?.type).toBe("list");
    expect(rows(last().list).map((x) => x.id)).toEqual(["STEP:1", "STEP:2", "STEP:3", "STEP:4"]);
    await handleZernioMessage(ctx, tapList("w-2", "STEP:1"), fake);
    const c = await getCustomer(ctx, KEY);
    expect(c?.state.locale).toBe("ru");
    expect(c?.platform).toBe("whatsapp");
  });

  it("каталог — списком: товар строкой PROD:<id>, «корзина» и «мои заказы» в навигации", async () => {
    await handleZernioMessage(ctx, text("w-3", "каталог"), fake);
    const list = last().list;
    expect(list?.type).toBe("list");
    // У демо-клиента корень каталога — разделы; пробный товар без раздела в нём не виден.
    const ids = rows(list).map((x) => x.id);
    expect(ids.some((id) => id.startsWith("CAT:") || id.startsWith("PROD:"))).toBe(true);
    expect(ids).toContain("CART");
    expect(rows(list).length).toBeLessThanOrEqual(10);
    for (const row of rows(list)) expect(row.title.length).toBeLessThanOrEqual(24);
    // Нажатие строки — карточка с кнопками (три кнопки WhatsApp тоже показывает).
    await handleZernioMessage(ctx, tapList("w-4", `PROD:${productId}`), fake);
    expect(last().text).toContain(PROBE_NAME);
    expect(last().text).toContain("2500");
    expect(last().buttons?.some((b) => /корзин/i.test(b))).toBe(true);
    expect(last().list).toBeUndefined();
  });

  it("оформление: страна списком → заказ с реквизитами", async () => {
    await handleZernioMessage(ctx, tapList("w-5", `BUY:${productId}`), fake);
    expect(last().text).toContain("Итого");
    await handleZernioMessage(ctx, tapList("w-6", "CHECKOUT"), fake);
    const countries = rows(last().list);
    const line = countries.find((x) => x.title.startsWith("Казахстан (v2"))!;
    expect(line).toBeTruthy();
    await handleZernioMessage(ctx, tapList("w-7", line.id), fake);
    expect(last().text).toMatch(/на почту/);
    expect(last().buttons).toEqual(["Без почты"]);
    await handleZernioMessage(
      ctx,
      {
        ...event("w-7a", { text: null }),
        metadata: { interactiveType: "button_reply", interactiveId: "EMAIL:skip" },
      },
      fake,
    );
    const instructions = sent.find((m) => m.text.includes("тестовые реквизиты WhatsApp"));
    expect(instructions).toBeTruthy();
    const c = await getCustomer(ctx, KEY);
    expect(c?.state.mode).toBe("awaiting_proof");
    orderId = Number(c?.state.pending_order_id);
    const order = await getOrder(ctx, orderId);
    expect(order?.platform).toBe("whatsapp");
    expect(order?.status).toBe("awaiting_payment");
  });

  it("корзина из каталога Meta: retailer id = id товара → в корзину и к оформлению", async () => {
    const before = sent.length;
    const r = await handleZernioMessage(
      ctx,
      event("wa-native-1", {
        metadata: {
          order: {
            catalog_id: "cat1",
            text: "побыстрее",
            product_items: [
              { product_retailer_id: productId, quantity: 2, item_price: 2500, currency: "KZT" },
            ],
          },
        },
        text: null,
      }),
      fake,
    );
    expect(r.status).toBe("processed");
    expect(sent.length).toBeGreaterThan(before);
    // Оформление началось: вопрос про страну или реквизиты.
    expect(last().text).toMatch(/стран|реквизит|Заказ #/i);
  });
});
