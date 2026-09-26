import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { liveReady, DEMO_BOT, TEST_TG_ID, dropOrderNotify } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { userKey } from "@/core/customers/customers";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import type { TelegramApi } from "@/channels/telegram/api";

/**
 * Полный заказ в Telegram-боте через handleTelegramUpdate, как его проходит
 * покупатель: /start → товар → «В корзину» → оформление → телефон → страна →
 * реквизиты → фото чека → продавец жмёт «Подтвердить и выдать» → файл у
 * покупателя. Telegram подменён, база и Storage — настоящие (демо-клиент).
 */
const TG = TEST_TG_ID + 61;
const SELLER = TEST_TG_ID + 62;
/** Владелец из карточки клиента, которого нет в admin_chat_id. */
const OWNER = TEST_TG_ID + 63;
const PROBE = "v2 live · заказ в Telegram";
const FILE_PATH = `${DEMO_BOT}/v2-live-order/material.pdf`;
const COUNTRY = "Казахстан (v2 live order)";

let ctx: TenantContext;
let productId = "";
let prevAdmins: string | null = null;
const orderIds: number[] = [];

type Call = [string, Record<string, unknown>];
const calls: Call[] = [];
// Байты чека уникальны на прогон: одинаковый чек второй раз не примут (дубль).
const receipt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
const api: TelegramApi = {
  call: async (method: string, payload: unknown = {}) => {
    calls.push([method, payload as Record<string, unknown>]);
    if (method === "getFile") return { ok: true, result: { file_path: "photos/receipt.jpg" } };
    return { ok: true, result: { message_id: calls.length } as never };
  },
  fileUrl: () => `data:image/jpeg;base64,${receipt.toString("base64")}`,
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

/** Последняя кнопка в сообщениях этому чату, чей callback_data подходит под образец. */
function button(re: RegExp, chat = TG): string | null {
  for (let i = calls.length - 1; i >= 0; i--) {
    const [, p] = calls[i]!;
    if (String(p.chat_id) !== String(chat)) continue;
    const kb = (p.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })
      ?.inline_keyboard;
    const hit = kb?.flat().find((b) => b.callback_data && re.test(b.callback_data));
    if (hit) return hit.callback_data!;
  }
  return null;
}

const sentTo = (chat: number, since: number) =>
  calls.slice(since).filter(([, p]) => String(p.chat_id) === String(chat));

async function cleanup() {
  const db = serviceDb();
  const { data: orders } = await db
    .from("orders")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("telegram_id", TG);
  for (const { id } of orders ?? []) orderIds.push(id);
  for (const id of new Set(orderIds)) {
    const { data: proofs } = await db.storage
      .from("payment-proofs")
      .list(`${DEMO_BOT}/order-${id}`);
    if (proofs?.length)
      await db.storage
        .from("payment-proofs")
        .remove(proofs.map((f) => `${DEMO_BOT}/order-${id}/${f.name}`));
    await db.from("zernio_logs").delete().eq("bot_id", DEMO_BOT).like("event_id", `order:${id}:%`);
    await dropOrderNotify(id);
    await db.from("order_items").delete().eq("order_id", id);
    await db.from("orders").delete().eq("id", id);
  }
  await db.from("cart_items").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("telegram", TG));
  const { data: probes } = await db
    .from("products")
    .select("id")
    .eq("bot_id", DEMO_BOT)
    .eq("name", PROBE);
  for (const { id } of probes ?? [])
    await db.from("product_material_files").delete().eq("product_id", id);
  await db.from("products").delete().eq("bot_id", DEMO_BOT).eq("name", PROBE);
  await db.from("payment_methods").delete().eq("bot_id", DEMO_BOT).eq("country_name", COUNTRY);
  await db.storage.from("product-files").remove([FILE_PATH]);
}

describe.skipIf(!liveReady)("полный заказ в Telegram-боте на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    // Автопроверку чеков и чат с менеджером выключаем: здесь — ручной путь.
    ctx = tenantContext({
      ...t,
      ownerTelegramId: OWNER,
      status: "active",
      modules: { ...t.modules, shop: true, receipt_ocr: false, manager_chat: false },
    });
    await cleanup();
    prevAdmins = await getSetting(ctx, "admin_chat_id");
    await setSetting(ctx, "admin_chat_id", String(SELLER));

    const up = await serviceDb()
      .storage.from("product-files")
      .upload(FILE_PATH, new Blob([Buffer.from("%PDF-1.4 v2 live\n")]), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (up.error) throw new Error(`upload material: ${up.error.message}`);
    const { data: p, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: PROBE,
        description: "живой тест заказа",
        price: 1500,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "digital",
        category_ids: [],
        country_prices: {},
      })
      .select("id")
      .single();
    if (error || !p) throw new Error(`seed product: ${error?.message}`);
    productId = p.id;
    const { error: fErr } = await ctx.db.from("product_material_files").insert({
      bot_id: DEMO_BOT,
      product_id: productId,
      language: "ru",
      file_path: FILE_PATH,
      file_name: "material.pdf",
      sort_order: 0,
    });
    if (fErr) throw new Error(`seed material: ${fErr.message}`);
    const { error: mErr } = await ctx.db.from("payment_methods").insert({
      bot_id: DEMO_BOT,
      country_code: "KZ",
      country_name: COUNTRY,
      instructions: "Kaspi: тестовые реквизиты v2 live",
      currency: "KZT",
      is_active: true,
      sort_order: -1,
    });
    if (mErr) throw new Error(`seed payment method: ${mErr.message}`);
  });
  afterAll(async () => {
    await setSetting(ctx, "admin_chat_id", prevAdmins ?? "");
    await cleanup();
  });

  it("покупатель проходит путь до чека, продавец подтверждает, файл уходит покупателю", async () => {
    await handleTelegramUpdate(ctx, api, text("/start"));
    expect(sentTo(TG, 0).length).toBeGreaterThan(0);

    // Карточка товара; без страны бот сначала спросит её.
    await handleTelegramUpdate(ctx, api, press(`prod:${productId}`));
    const setCountry = button(/^setcountry:KZ/);
    if (setCountry) {
      await handleTelegramUpdate(ctx, api, press(setCountry));
      await handleTelegramUpdate(ctx, api, press(`prod:${productId}`));
    }
    const add = button(new RegExp(`^add:${productId}`));
    expect(add, "в карточке нет кнопки «В корзину»").not.toBeNull();
    await handleTelegramUpdate(ctx, api, press(add!));
    expect(calls.some(([m, p]) => m === "answerCallbackQuery" && p.show_alert === false)).toBe(
      true,
    );

    // Оформление: телефон кнопкой «поделиться контактом».
    await handleTelegramUpdate(ctx, api, press("checkout"));
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 2,
        chat: { id: TG, type: "private" },
        from: from(TG),
        contact: { phone_number: "+77001234567" },
      },
    });
    const country = button(/^country:KZ/);
    if (country) await handleTelegramUpdate(ctx, api, press(country));
    const pay = button(/^pay:manual:/);
    if (pay) await handleTelegramUpdate(ctx, api, press(pay));

    const { data: order } = await serviceDb()
      .from("orders")
      .select("id, status, total, currency, platform, order_items(name_snapshot, quantity)")
      .eq("bot_id", DEMO_BOT)
      .eq("telegram_id", TG)
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(order, "заказ не создан").toBeTruthy();
    orderIds.push(order!.id);
    expect(order).toMatchObject({ status: "awaiting_payment", platform: "telegram" });
    expect(Number(order!.total)).toBe(1500);
    expect(order!.order_items).toEqual([{ name_snapshot: PROBE, quantity: 1 }]);
    expect(
      sentTo(TG, 0).some(([, p]) => String(p.text ?? p.caption ?? "").includes("v2 live")),
      "покупатель не увидел реквизиты",
    ).toBe(true);

    // Фото чека → заказ на проверке, продавцу пришли кнопки.
    const beforeProof = calls.length;
    await handleTelegramUpdate(ctx, api, {
      update_id: 1,
      message: {
        message_id: 3,
        chat: { id: TG, type: "private" },
        from: from(TG),
        photo: [{ file_id: "receipt-photo" }],
      },
    });
    const { data: checking } = await serviceDb()
      .from("orders")
      .select("status, payment_proof_path")
      .eq("id", order!.id)
      .single();
    expect(checking?.status).toBe("awaiting_confirmation");
    expect(checking?.payment_proof_path).toContain(`${DEMO_BOT}/order-${order!.id}/`);
    expect(sentTo(TG, beforeProof).length, "покупатель не получил «чек получен»").toBeGreaterThan(
      0,
    );
    const confirm = button(new RegExp(`^confirm:${order!.id}$`), SELLER);
    expect(confirm, "продавцу не пришла кнопка «Подтвердить и выдать»").not.toBeNull();

    // Чужой не может подтвердить.
    const beforeStranger = calls.length;
    await handleTelegramUpdate(ctx, api, press(confirm!, TG));
    expect(sentTo(TG, beforeStranger).some(([, p]) => String(p.text).startsWith("⛔"))).toBe(true);

    // Продавец подтверждает → файл у покупателя, заказ выдан; повтор не двоит.
    const beforeConfirm = calls.length;
    await handleTelegramUpdate(ctx, api, press(confirm!, SELLER));
    const { data: done } = await serviceDb()
      .from("orders")
      .select("status")
      .eq("id", order!.id)
      .single();
    expect(done?.status).toBe("delivered");
    const files = sentTo(TG, beforeConfirm).filter(
      ([m, p]) => m === "sendDocument" || String(p.text ?? "").includes("product-files"),
    );
    expect(files, "покупатель не получил файл").toHaveLength(1);
    expect(sentTo(SELLER, beforeConfirm).some(([, p]) => String(p.text).startsWith("✅"))).toBe(
      true,
    );

    const beforeRepeat = calls.length;
    await handleTelegramUpdate(ctx, api, press(confirm!, SELLER));
    expect(sentTo(TG, beforeRepeat)).toHaveLength(0);
    expect(sentTo(SELLER, beforeRepeat).some(([, p]) => String(p.text).includes("уже"))).toBe(true);
  });

  it("владелец не из admin_chat_id получает кнопки заказа и может их нажать", async () => {
    const order = orderIds.length ? orderIds[orderIds.length - 1]! : null;
    const reject = button(/^reject:\d+$/, OWNER);
    expect(reject, "владельцу не пришла кнопка «Отклонить»").not.toBeNull();
    const before = calls.length;
    await handleTelegramUpdate(ctx, api, press(reject!, OWNER));
    const answers = sentTo(OWNER, before).map(([, p]) => String(p.text));
    expect(
      answers.some((t) => t.startsWith("⛔")),
      `владелец получил ⛔ (заказ ${order})`,
    ).toBe(false);
    // Заказ уже выдан — отклонять нечего, но это ответ по делу, а не отказ в доступе.
    expect(answers.some((t) => t.includes("уже закрыт"))).toBe(true);
  });
});
