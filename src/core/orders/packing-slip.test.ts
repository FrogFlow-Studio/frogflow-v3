import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { GIFT_WRAP_MARK } from "@/core/orders/gift-wrap";
import { buildPackingSlip } from "./packing-slip";

const BOT = "11111111-1111-1111-1111-111111111111";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "11111111-aaaa-4aaa-8aaa-111111111111";
const P2 = "22222222-aaaa-4aaa-8aaa-222222222222";

function setup(withGift = true) {
  const db = fakeDb();
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: `bundle:${B}`,
      value: JSON.stringify({
        items: [
          { p: P1, q: 2 },
          { p: P2, q: 1 },
        ],
      }),
    },
  ];
  db.tables.products = [
    { id: P1, name: "Шампунь" },
    { id: P2, name: "Бальзам" },
  ];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      display_no: 7,
      created_at: "2026-10-04T09:00:00Z",
      fulfillment_at: "2026-10-10T00:00:00Z",
      fulfillment_type: "delivery",
      fulfillment_address: "ул. Секретная, 1",
      contact: "+77001234567",
      admin_note: "скидка 7777 ₸ по знакомству",
      total: 7777,
      paid_amount: 7777,
    },
  ];
  db.tables.order_items = [
    {
      id: "a1",
      order_id: 7,
      product_id: B,
      name_snapshot: "Набор «Уход»",
      price_snapshot: 5555,
      quantity: 2,
    },
    {
      id: "a2",
      order_id: 7,
      product_id: null,
      name_snapshot: `${GIFT_WRAP_MARK}Подарочная упаковка`,
      price_snapshot: 1111,
      quantity: 1,
    },
  ];
  db.tables.zernio_logs = withGift
    ? [
        {
          event_id: "order:7:gift:once",
          event_type: "order.gift",
          status: "event",
          payload: { recipient: "Мама", message: "С днём рождения!", truncated: false },
        },
      ]
    : [];
  const ctx = {
    tenant: { id: BOT, modules: { bundles: true } },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("упаковочный лист", () => {
  it("есть получатель, открытка, упаковка и состав набора на заказанное число", async () => {
    const { ctx } = setup();
    const s = await buildPackingSlip(ctx, 7);
    expect(s).toMatchObject({
      orderNo: 7,
      wrap: true,
      gift: { recipient: "Мама", message: "С днём рождения!" },
    });
    expect(s!.lines).toEqual([
      {
        name: "Набор «Уход»",
        qty: 2,
        parts: [
          { name: "Шампунь", qty: 4 },
          { name: "Бальзам", qty: 2 },
        ],
      },
    ]);
  });

  it("ни цен, ни сумм, ни контактов, ни адреса, ни заметок продавца в листе нет", async () => {
    const { ctx } = setup();
    const raw = JSON.stringify(await buildPackingSlip(ctx, 7));
    for (const secret of ["5555", "1111", "7777", "+7700", "Секретная", "знакомству", "price"])
      expect(raw).not.toContain(secret);
    // Строка упаковки — не товар: отдельной позицией она не печатается.
    expect(raw).not.toContain(GIFT_WRAP_MARK);
  });

  it("заказ без подарка: лист без блока подарка; нет заказа — null", async () => {
    const { ctx } = setup(false);
    expect((await buildPackingSlip(ctx, 7))!.gift).toBeNull();
    expect(await buildPackingSlip(ctx, 99)).toBeNull();
  });
});
