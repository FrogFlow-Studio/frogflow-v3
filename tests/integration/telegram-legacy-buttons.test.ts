import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID, dropDemoOrder } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { setState, upsertCustomer, userKey, type Customer } from "@/core/customers/customers";
import { addToCart } from "@/core/cart/cart";
import { deliverOrder, getOrder, placeOrder } from "@/core/orders/orders";
import { displayNo } from "@/core/orders/pure";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import { COPY } from "@/channels/telegram/copy";
import type { TelegramApi } from "@/channels/telegram/api";

/**
 * Кнопки прежней платформы в старых чатах покупателей после переезда:
 * `lang_<язык>:<заказ>:<индекс>` (язык материалов после оплаты) и
 * `searchmore:<сдвиг>` (следующая страница поиска). Telegram подменён,
 * база — настоящая (демо-клиент).
 */
const TG = TEST_TG_ID + 63;
const STRANGER = TEST_TG_ID + 64;
const LANG_PROBE = "v2 legacy · материал";
const SEARCH_PROBE = "v2 legacy · поиск";
const SEARCH_WORD = "zzqlegacybtn";
const COUNTRY = "Казахстан (v2 legacy)";

let ctx: TenantContext;
let customer: Customer;
let productId = "";
const orders: number[] = [];

type Call = [string, Record<string, unknown>];
const calls: Call[] = [];
const api: TelegramApi = {
  call: async (method: string, payload: unknown = {}) => {
    calls.push([method, payload as Record<string, unknown>]);
    return { ok: true, result: { message_id: calls.length } as never };
  },
  fileUrl: () => "https://example.com/file",
} as unknown as TelegramApi;

const from = (id: number) => ({ id, first_name: "Покупатель", language_code: "ru" });
const text = (t: string) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: TG, type: "private" }, from: from(TG), text: t },
});
const press = (data: string, who = TG) => ({
  update_id: 1,
  callback_query: { id: `cq-${data}`, from: from(who), message: { chat: { id: who } }, data },
});

const sinceText = (since: number) =>
  calls
    .slice(since)
    .map(([, p]) => String(p.caption ?? p.text ?? ""))
    .join("\n");
const buttonsSince = (since: number) =>
  calls
    .slice(since)
    .flatMap(
      ([, p]) =>
        (p.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })
          ?.inline_keyboard ?? [],
    )
    .flat()
    .map((b) => b.callback_data ?? "");
const probesShown = (since: number) =>
  (sinceText(since).match(new RegExp(`${SEARCH_PROBE} \\d`, "g")) ?? []).length;

async function cleanup() {
  const db = serviceDb();
  for (const id of orders) {
    await db.from("order_items").delete().eq("order_id", id);
    await dropDemoOrder(id);
  }
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  for (const id of [TG, STRANGER])
    await db
      .from("bot_users")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .eq("user_key", userKey("telegram", id));
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", LANG_PROBE);
  await db.from("products").delete().eq("bot_id", DEMO_BOT).like("name", `${SEARCH_PROBE}%`);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY);
}

describe.skipIf(!liveReady)("кнопки v1 в старых чатах на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...t,
      status: "active",
      modules: {
        ...t.modules,
        shop: true,
        multi_language: true,
        manager_chat: false,
        smart_search: false,
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
        name: LANG_PROBE,
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
    const { error: e2 } = await ctx.db.from("products").insert(
      Array.from({ length: 7 }, (_, i) => ({
        bot_id: DEMO_BOT,
        name: `${SEARCH_PROBE} ${i + 1}`,
        keywords: SEARCH_WORD,
        price: 100,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
      })),
    );
    if (e2) throw new Error(`seed search products: ${e2.message}`);
    await ctx.db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY,
      instructions: "тест",
      currency: "KZT",
      is_active: true,
      sort_order: 97,
    });
    customer = await upsertCustomer(ctx, "telegram", TG, { firstName: "Кнопки v1" });
  });
  afterAll(cleanup);

  it("lang_<язык>:<заказ>:<индекс> выдаёт файл на выбранном языке и закрывает заказ", async () => {
    expect(await addToCart(ctx, customer, productId)).toBe("ok");
    const r = await placeOrder(ctx, customer, "KZ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    orders.push(r.order.id);
    const d = await deliverOrder(ctx, r.order.id, async () => "sent" as const, {
      lang: "ru",
      ask: async () => true,
    });
    expect(d.pending).toBe(1);

    // Чужой покупатель с той же кнопкой ничего не получает.
    await handleTelegramUpdate(ctx, api, press(`lang_kk:${r.order.id}:0`, STRANGER));
    expect(
      (await getOrder(ctx, r.order.id))?.order_items[0]?.delivered_language ?? null,
    ).toBeNull();

    const since = calls.length;
    await handleTelegramUpdate(ctx, api, press(`lang_kk:${r.order.id}:0`));
    const o = await getOrder(ctx, r.order.id);
    expect(o?.order_items[0]?.delivered_language).toBe("kk");
    expect(o?.status).toBe("delivered");
    expect(sinceText(since)).toContain(COPY.ru.orderDelivered(displayNo(o!)));

    // Повторное нажатие — «уже отправлен», без второго файла.
    const again = calls.length;
    await handleTelegramUpdate(ctx, api, press(`lang_kk:${r.order.id}:0`));
    expect(sinceText(again)).toContain(COPY.ru.fileAlreadySent);
  });

  it("поиск показывает по 5 и «Показать ещё» (searchmore:5) докладывает остальное", async () => {
    await handleTelegramUpdate(ctx, api, text(COPY.ru.search));
    const first = calls.length;
    await handleTelegramUpdate(ctx, api, text(SEARCH_WORD));
    expect(sinceText(first)).toContain(COPY.ru.searchResults(SEARCH_WORD, 7));
    expect(probesShown(first)).toBe(5);
    expect(buttonsSince(first)).toContain("searchmore:5");

    const second = calls.length;
    await handleTelegramUpdate(ctx, api, press("searchmore:5"));
    expect(probesShown(second)).toBe(2);
    expect(buttonsSince(second).some((b) => b.startsWith("searchmore:"))).toBe(false);
  });

  it("searchmore: без запомненного запроса — «повторите поиск»", async () => {
    const c = await upsertCustomer(ctx, "telegram", TG, {});
    await setState(ctx, c, { ...c.state, last_search: undefined });
    const since = calls.length;
    await handleTelegramUpdate(ctx, api, press("searchmore:5"));
    expect(sinceText(since)).toContain(COPY.ru.searchExpired);
  });
});
