import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { describeOrderEvent, listOrderEvents } from "./events";
import { GIFT_MESSAGE_MAX, GIFT_NAME_MAX, loadOrderGift, normalizeGift } from "./gift";
import { placeOrder } from "./orders";

const BOT = "11111111-1111-1111-1111-111111111111";
const TG = 555;

function setup(modules: Record<string, boolean> = { bundles: true }) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.rpc = async () => ({ data: true, error: null });
  db.tables.bot_users = [{ telegram_id: TG, user_key: `tg:${TG}`, loyalty_points: 0, state: {} }];
  db.tables.payment_methods = [
    { id: "pm-1", country_code: "KZ", country_name: "Казахстан", is_active: true, sort_order: 1 },
  ];
  db.tables.cart_items = [
    {
      id: "c-1",
      telegram_id: TG,
      quantity: 1,
      product_variant_id: null,
      created_at: "2026-10-01T00:00:00Z",
      products: {
        id: "p-1",
        name: "Торт",
        price: 5000,
        currency: "KZT",
        fulfillment_kind: "physical",
        stock_quantity: null,
      },
      product_variants: null,
    },
  ];
  db.tables.app_settings = [];
  const ctx = { tenant: { id: BOT, modules, settings: {} }, db } as unknown as TenantContext;
  const customer: Customer = {
    userKey: `tg:${TG}`,
    platform: "telegram",
    telegramId: TG,
    username: null,
    firstName: "Аня",
    lastName: null,
    languageCode: "ru",
    contactPhone: null,
    email: null,
    loyaltyPoints: 0,
    state: {},
    zernioConversationId: null,
    zernioAccountId: null,
  };
  return { db, ctx, customer };
}

describe("«Это подарок»: нормализация", () => {
  it("короткое сохраняется как есть, пробелы в имени схлопываются", () => {
    expect(
      normalizeGift({ recipient: "  Анна   Петровна ", message: " С днём рождения! " }),
    ).toEqual({
      recipient: "Анна Петровна",
      message: "С днём рождения!",
      truncated: false,
    });
    expect(normalizeGift({})).toEqual({ recipient: "", message: "", truncated: false });
  });

  it("длинная открытка режется до 300 и об этом сказано флагом", () => {
    const g = normalizeGift({ message: "я".repeat(GIFT_MESSAGE_MAX + 50) });
    expect(Array.from(g.message)).toHaveLength(GIFT_MESSAGE_MAX);
    expect(g.truncated).toBe(true);
    expect(normalizeGift({ message: "я".repeat(GIFT_MESSAGE_MAX) }).truncated).toBe(false);
  });

  it("длинное имя режется до 100; эмодзи не рвутся посередине", () => {
    const g = normalizeGift({ recipient: "😀".repeat(GIFT_NAME_MAX + 1) });
    expect(Array.from(g.recipient)).toHaveLength(GIFT_NAME_MAX);
    expect(g.recipient.endsWith("😀")).toBe(true);
    expect(g.truncated).toBe(true);
  });
});

describe("«Это подарок»: заказ", () => {
  it("подарок записан событием заказа и читается обратно (карточка, уведомление)", async () => {
    const { ctx, db, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", {
      gift: { recipient: "Анна", message: "Люблю!" },
    });
    expect(r.ok && r.gift).toEqual({ recipient: "Анна", message: "Люблю!", truncated: false });
    const id = db.tables.orders![0]!.id as number;
    expect(await loadOrderGift(ctx, id)).toEqual({
      recipient: "Анна",
      message: "Люблю!",
      truncated: false,
    });
    const events = await listOrderEvents(ctx, id);
    const ev = events.find((e) => e.kind === "gift")!;
    expect(describeOrderEvent(ev).text).toBe("🎁 Подарок для Анна: «Люблю!»");
  });

  it("длинный текст режется на сервере и результат говорит об этом", async () => {
    const { ctx, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", {
      gift: { recipient: "Анна", message: "я".repeat(400) },
    });
    expect(r.ok && r.gift?.truncated).toBe(true);
    expect(r.ok && Array.from(r.gift!.message)).toHaveLength(GIFT_MESSAGE_MAX);
  });

  it("без отметки ничего не меняется: события нет, подарка нет", async () => {
    const { ctx, db, customer } = setup();
    const r = await placeOrder(ctx, customer, "KZ", {});
    expect(r.ok && r.gift).toBeNull();
    expect(await loadOrderGift(ctx, db.tables.orders![0]!.id as number)).toBeNull();
    expect((db.tables.zernio_logs ?? []).some((l) => l.event_type === "order.gift")).toBe(false);
  });

  it("модуль выключен — отметка игнорируется", async () => {
    const { ctx, db, customer } = setup({});
    const r = await placeOrder(ctx, customer, "KZ", { gift: { recipient: "Анна" } });
    expect(r.ok && r.gift).toBeNull();
    expect((db.tables.zernio_logs ?? []).some((l) => l.event_type === "order.gift")).toBe(false);
  });
});
