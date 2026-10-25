import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { Customer } from "@/core/customers/customers";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { listCustomerOrderStatuses } from "./order-queries";

const BOT = "11111111-1111-1111-1111-111111111111";
const OTHER_BOT = "22222222-2222-2222-2222-222222222222";

function ctxOf(db: ReturnType<typeof fakeDb>): TenantContext {
  return { tenant: { id: BOT }, db } as unknown as TenantContext;
}

describe("listCustomerOrderStatuses", () => {
  it("ограничивает чтение ботом и текущим покупателем и возвращает только безопасные поля", async () => {
    const db = fakeDb();
    db.tables.orders = [
      {
        id: 41,
        bot_id: BOT,
        telegram_id: -777,
        user_key: "wa_777",
        order_no: 41,
        display_no: 41,
        status: "cancelled",
        created_at: "2026-10-25T08:00:00.000Z",
        customer_phone: "+77000000000",
      },
      {
        id: 42,
        bot_id: OTHER_BOT,
        telegram_id: -777,
        order_no: 42,
        display_no: 42,
        status: "paid",
        created_at: "2026-10-25T09:00:00.000Z",
      },
      {
        id: 43,
        bot_id: BOT,
        telegram_id: -999,
        order_no: 43,
        display_no: 43,
        status: "paid",
        created_at: "2026-10-25T10:00:00.000Z",
      },
    ];
    const buyer = {
      userKey: "wa_777",
      platform: "whatsapp",
      telegramId: -777,
    } as Customer;

    const rows = await listCustomerOrderStatuses(ctxOf(db), buyer);

    expect(rows).toEqual([
      {
        id: 41,
        order_no: 41,
        display_no: 41,
        status: "cancelled",
        created_at: "2026-10-25T08:00:00.000Z",
      },
    ]);
  });

  it("предпочитает pending order id только при совпадении бота и покупателя", async () => {
    const db = fakeDb();
    db.tables.orders = [
      {
        id: 41,
        bot_id: BOT,
        telegram_id: -777,
        order_no: 41,
        display_no: 41,
        status: "awaiting_payment",
        created_at: "2026-10-25T08:00:00.000Z",
      },
      {
        id: 42,
        bot_id: OTHER_BOT,
        telegram_id: -777,
        order_no: 42,
        display_no: 42,
        status: "paid",
        created_at: "2026-10-25T09:00:00.000Z",
      },
      {
        id: 43,
        bot_id: BOT,
        telegram_id: -999,
        order_no: 43,
        display_no: 43,
        status: "paid",
        created_at: "2026-10-25T10:00:00.000Z",
      },
    ];
    const buyer = { userKey: "wa_777", platform: "whatsapp", telegramId: -777 } as Customer;

    const rows = await listCustomerOrderStatuses(ctxOf(db), buyer, 5, 41);

    expect(rows.map((row) => row.id)).toEqual([41]);
  });
});
