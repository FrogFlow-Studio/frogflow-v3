import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { canResendMaterials } from "@/core/orders/pure";
import { handleTelegramUpdate } from "./handle-update";
import type { TelegramApi } from "./api";

/**
 * Кнопка «Отправить файлы ещё раз» (resend:<id>) из «Моих заказов». Кнопка
 * живёт в чате вечно и callback_data можно подделать — обработчик сам
 * решает, можно ли повторять выдачу.
 */
const TG = 42;
const from = { id: TG, is_bot: false, first_name: "A" };

/** Журнал заказа — строки order.* в zernio_logs. */
const started = (db: FakeDb) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "order.delivery_started");

function setup(order: Record<string, unknown>) {
  const db: FakeDb = fakeDb();
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale: "ru" },
    },
  ];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      bot_id: "bot-1",
      telegram_id: TG,
      status: "delivered",
      total: 15000,
      currency: "KZT",
      fulfillment_kind: "physical",
      order_items: [],
      ...order,
    },
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: {},
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: string[] = [];
  const api = {
    call: vi.fn(async (method: string) => {
      calls.push(method);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  const press = (data: string) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      callback_query: {
        id: "cq-1",
        from,
        data,
        message: { message_id: 5, date: 0, chat: { id: TG, type: "private" } },
      },
    } as never);
  return { db, calls, press, order: () => db.tables.orders![0]! };
}

describe("повторная отправка файлов по кнопке", () => {
  it("выданный физический заказ не возвращается в «оплачен» и не выдаётся заново", async () => {
    const { calls, press, order, db } = setup({ fulfillment_kind: "physical" });
    await press("resend:7");
    expect(order().status).toBe("delivered");
    expect(started(db)).toEqual([]);
    expect(calls).toEqual(["answerCallbackQuery"]);
  });

  it("чужой заказ не трогаем", async () => {
    const { press, order } = setup({ fulfillment_kind: "digital", telegram_id: TG + 1 });
    await press("resend:7");
    expect(order().status).toBe("delivered");
  });

  it("невыданный цифровой заказ кнопкой не выдаётся", async () => {
    const { press, order } = setup({ fulfillment_kind: "digital", status: "awaiting_payment" });
    await press("resend:7");
    expect(order().status).toBe("awaiting_payment");
  });

  it("свой выданный цифровой заказ выдаётся ещё раз", async () => {
    const { press, db } = setup({ fulfillment_kind: "digital" });
    await press("resend:7");
    expect(started(db)).toHaveLength(1);
  });
});

describe("canResendMaterials", () => {
  it("только выданный и не физический", () => {
    expect(canResendMaterials({ status: "delivered", fulfillment_kind: "digital" })).toBe(true);
    expect(canResendMaterials({ status: "delivered", fulfillment_kind: "physical" })).toBe(false);
    expect(canResendMaterials({ status: "paid", fulfillment_kind: "digital" })).toBe(false);
  });
});
