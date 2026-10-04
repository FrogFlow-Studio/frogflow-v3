import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ParsedZernioMessage } from "./message";
import type { ZernioTransport } from "./api.server";
import { handleShopMessage } from "./shop.server";

/** «Это подарок» в Direct/WhatsApp: да/нет, имя получателя, открытка, пропуск. */
function shop(modules: Record<string, boolean> = { bundles: true }, ask = true) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [
    {
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      loyalty_points: 0,
      state: { locale: "ru", mode: "awaiting_gift_choice", country_code: "KZ", gift_asked: true },
    },
  ];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: -1,
      user_key: "ig_1",
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-10-01T00:00:00Z",
      products: {
        id: "p-1",
        name: "Гайд",
        price: 5000,
        currency: "KZT",
        fulfillment_kind: "digital",
        stock_quantity: null,
      },
      product_variants: null,
    },
  ];
  db.tables.app_settings = [
    { bot_id: "bot-1", key: "shop_currency", value: "KZT" },
    ...(ask ? [{ bot_id: "bot-1", key: "gift_ask", value: "1" }] : []),
  ];
  const ctx = {
    tenant: { id: "bot-1", status: "active", vertical: "digital", modules, settings: {} },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const sent: string[] = [];
  const transport = {
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: vi.fn(async () => []),
    mailReady: () => false,
  } as unknown as ZernioTransport;
  const customer = () =>
    ({
      userKey: "ig_1",
      platform: "instagram",
      telegramId: -1,
      loyaltyPoints: 0,
      contactPhone: "+77001234567",
      state: db.tables.bot_users![0]!.state,
    }) as unknown as Customer;
  const msg = (text: string, postbackPayload: string | null = null) =>
    handleShopMessage(
      ctx,
      customer(),
      {
        conversationId: "conv-1",
        accountId: "acc-1",
        platform: "instagram",
        text,
        postbackPayload,
        nativeOrder: null,
        attachments: [],
      } as unknown as ParsedZernioMessage,
      transport,
    );
  const state = () => db.tables.bot_users![0]!.state as Record<string, unknown>;
  const giftRows = () => (db.tables.zernio_logs ?? []).filter((l) => l.event_type === "order.gift");
  return { db, msg, state, sent, giftRows };
}

describe("Direct: «это подарок?» перед оформлением", () => {
  it("«да» → имя → открытка: заказ создан, подарок записан событием", async () => {
    const s = shop();
    await s.msg("да");
    expect(s.state()).toMatchObject({ mode: "awaiting_gift_recipient", gift_on: true });
    await s.msg("Анна");
    expect(s.state()).toMatchObject({ mode: "awaiting_gift_message", gift_recipient: "Анна" });
    await s.msg("С днём рождения!");
    expect(s.db.tables.orders).toHaveLength(1);
    expect(s.giftRows()).toHaveLength(1);
    expect(s.giftRows()[0]!.payload).toMatchObject({
      recipient: "Анна",
      message: "С днём рождения!",
    });
    // Одноразовые данные подарка не липнут к следующему заказу.
    expect(s.state().gift_on).toBeUndefined();
    expect(s.state().gift_asked).toBeUndefined();
  });

  it("кнопка «Пропустить» — подарок без открытки", async () => {
    const s = shop();
    await s.msg("", "GIFT:yes");
    await s.msg("Анна");
    await s.msg("", "GIFT:skip");
    expect(s.db.tables.orders).toHaveLength(1);
    expect(s.giftRows()[0]!.payload).toMatchObject({ recipient: "Анна", message: "" });
  });

  it("«нет» — обычный заказ без события", async () => {
    const s = shop();
    await s.msg("нет");
    expect(s.db.tables.orders).toHaveLength(1);
    expect(s.giftRows()).toHaveLength(0);
  });

  it("длинная открытка режется, покупателю сказано об этом", async () => {
    const s = shop();
    await s.msg("да");
    await s.msg("Анна");
    await s.msg("я".repeat(350));
    expect(s.sent.some((t) => t.includes("Текст длиннее 300 символов"))).toBe(true);
    expect(
      Array.from(String((s.giftRows()[0]!.payload as { message: string }).message)),
    ).toHaveLength(300);
  });
});

describe("Direct: вопрос «это подарок?» — настройка, физический заказ, один переспрос", () => {
  const fresh = (s: ReturnType<typeof shop>, kind: "physical" | "digital" = "physical") => {
    s.db.tables.bot_users![0]!.state = { locale: "ru", country_code: "KZ" };
    (s.db.tables.cart_items![0]!.products as { fulfillment_kind: string }).fulfillment_kind = kind;
  };
  /** Физический заказ идёт через выдачу, дату и пожелания; дата — ближайшая из подсказки бота. */
  const toGiftStep = async (
    s: ReturnType<typeof shop>,
    kind: "physical" | "digital" = "physical",
  ) => {
    await s.msg("", "CHECKOUT");
    if (kind === "digital") return;
    await s.msg("", "FT:pickup");
    await s.msg(/(\d{2}\.\d{2}\.\d{4})\.?$/.exec(s.sent.at(-1)!)![1]!);
    await s.msg("", "NOTE:skip");
  };
  it("настройка включена, заказ физический — перед оформлением спрашиваем", async () => {
    const s = shop({ bundles: true }, true);
    fresh(s);
    await toGiftStep(s);
    expect(s.state()).toMatchObject({ mode: "awaiting_gift_choice", gift_asked: true });
    expect(s.db.tables.orders ?? []).toHaveLength(0);
  });
  it("настройка не включена — заказ оформляется без вопроса", async () => {
    const s = shop({ bundles: true }, false);
    fresh(s);
    await toGiftStep(s);
    expect(s.state().mode).not.toBe("awaiting_gift_choice");
    expect(s.db.tables.orders).toHaveLength(1);
    expect(s.giftRows()).toHaveLength(0);
  });
  it("цифровой заказ — шага нет, даже при включённой настройке", async () => {
    const s = shop({ bundles: true }, true);
    fresh(s, "digital");
    await toGiftStep(s, "digital");
    expect(s.state().mode).not.toBe("awaiting_gift_choice");
    expect(s.db.tables.orders).toHaveLength(1);
    expect(s.giftRows()).toHaveLength(0);
  });
  it("два непонятных ответа подряд — считаем «нет», заказ оформлен", async () => {
    const s = shop({ bundles: true }, true);
    fresh(s);
    await toGiftStep(s);
    const asked = s.sent.length;
    await s.msg("хм, а что это?");
    // Первый непонятный ответ: переспросили, заказа ещё нет.
    expect(s.sent.length).toBe(asked + 1);
    expect(s.state()).toMatchObject({ mode: "awaiting_gift_choice", gift_reask: true });
    expect(s.db.tables.orders ?? []).toHaveLength(0);
    await s.msg("не знаю");
    expect(s.db.tables.orders).toHaveLength(1);
    expect(s.giftRows()).toHaveLength(0);
    expect(s.state().gift_reask).toBeUndefined();
  });
  it("непонятный ответ, потом «да» — подарок продолжается", async () => {
    const s = shop({ bundles: true }, true);
    fresh(s);
    await toGiftStep(s);
    await s.msg("может быть");
    await s.msg("да");
    expect(s.state()).toMatchObject({ mode: "awaiting_gift_recipient", gift_on: true });
    expect(s.state().gift_reask).toBeUndefined();
  });
});
