import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrder } from "../core/money/money";
import { saveProduct, touchBuyer } from "../core/platform";
import { pgliteV4, v4Db } from "../test/pg";
import { applyVerifiedGateway } from "./gateway.server";
import { v4PaidFacts } from "./gateway-facts";

const ORDER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const SHOP = "bbbbbbbb-0000-4000-8000-0000000000c9";

describe("факты оплаты v4", () => {
  it("Stripe: только оплаченная сессия, числовой заказ v3 не берётся", () => {
    const session = (type: string, payment_status: string, order: string) => ({
      type,
      data: {
        object: {
          object: "checkout.session",
          id: "cs_1",
          payment_status,
          amount_total: 100_000,
          currency: "kzt",
          payment_intent: "pi_1",
          metadata: { v4_order_id: order },
        },
      },
    });
    expect(v4PaidFacts("stripe", session("checkout.session.expired", "unpaid", ORDER))).toBeNull();
    expect(
      v4PaidFacts("stripe", session("checkout.session.completed", "unpaid", ORDER)),
    ).toBeNull();
    expect(v4PaidFacts("stripe", session("checkout.session.completed", "paid", "274"))).toBeNull();
    expect(v4PaidFacts("stripe", session("checkout.session.completed", "paid", ORDER))).toEqual({
      orderId: ORDER,
      amountMinor: 100_000,
      currency: "KZT",
      externalRef: "pi_1",
    });
    expect(
      v4PaidFacts("stripe", session("checkout.session.async_payment_succeeded", "paid", ORDER))
        ?.externalRef,
    ).toBe("pi_1");
  });

  it("Prodamus только success, NOWPayments только finished, Kaspi только paid", () => {
    expect(
      v4PaidFacts("prodamus", {
        payment_status: "order_canceled",
        sum: "1500.00",
        currency: "kzt",
        v4_order_id: ORDER,
        order_num: "n1",
      }),
    ).toBeNull();
    expect(
      v4PaidFacts("prodamus", {
        payment_status: "success",
        sum: "1500.00",
        currency: "kzt",
        v4_order_id: ORDER,
        order_num: "n1",
      }),
    ).toMatchObject({ amountMinor: 150_000, externalRef: "n1" });
    expect(
      v4PaidFacts("nowpayments", {
        payment_status: "waiting",
        order_id: ORDER,
        price_amount: 100,
        price_currency: "kzt",
        payment_id: 9,
      }),
    ).toBeNull();
    expect(
      v4PaidFacts("nowpayments", {
        payment_status: "finished",
        order_id: ORDER,
        price_amount: 100,
        price_currency: "kzt",
        payment_id: 9,
      }),
    ).toMatchObject({ amountMinor: 10_000, externalRef: "9" });
    expect(
      v4PaidFacts("kaspi", {
        event: "invoice.status_changed",
        invoice: {
          status: "expired",
          amount: 10,
          currency: "KZT",
          id: 1,
          external_order_id: ORDER,
        },
      }),
    ).toBeNull();
    expect(
      v4PaidFacts("kaspi", {
        event: "invoice.status_changed",
        invoice: { status: "paid", amount: 10, currency: "KZT", id: 1, external_order_id: ORDER },
      }),
    ).toMatchObject({ amountMinor: 1_000 });
  });
});

describe("книга не получает неоплаченное", () => {
  let pg: PGlite;
  let orderId = "";
  const db = () => pgliteV4(pg);

  beforeAll(async () => {
    pg = await v4Db();
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [SHOP]);
    const saved = await saveProduct(db(), {
      botId: SHOP,
      title: "Файл",
      kind: "file",
      priceMinor: 100_000,
    });
    if (!saved.ok) throw new Error(saved.code);
    const buyer = await touchBuyer(db(), {
      botId: SHOP,
      channel: "web",
      externalId: "pay",
      country: "KZ",
    });
    const order = await createOrder(db(), {
      botId: SHOP,
      buyerId: buyer,
      country: "KZ",
      productIds: [saved.value],
      by: "test",
    });
    if (!order.ok) throw new Error(order.code);
    orderId = order.value.id;
  }, 60_000);
  afterAll(async () => pg.close());

  const ledger = () =>
    pg.query<{ n: number }>("select count(*)::int n from v4.ledger where bot_id = $1", [SHOP]);

  it("истёкшая сессия Stripe, неуспешный Prodamus и NOWPayments waiting не пишут книгу", async () => {
    await applyVerifiedGateway(db(), SHOP, "stripe", {
      type: "checkout.session.expired",
      data: {
        object: {
          object: "checkout.session",
          payment_status: "unpaid",
          amount_total: 100_000,
          currency: "kzt",
          metadata: { v4_order_id: orderId },
        },
      },
    });
    await applyVerifiedGateway(db(), SHOP, "prodamus", {
      payment_status: "order_canceled",
      sum: "1000.00",
      currency: "kzt",
      v4_order_id: orderId,
      order_num: "p1",
    });
    await applyVerifiedGateway(db(), SHOP, "nowpayments", {
      payment_status: "waiting",
      order_id: orderId,
      price_amount: 1000,
      price_currency: "kzt",
      payment_id: 4,
    });
    expect((await ledger()).rows[0]!.n).toBe(0);
  });

  it("оплата по несуществующему заказу открывает дело и не пишет книгу", async () => {
    const missing = "cccccccc-0000-4000-8000-0000000000c1";
    const r = await applyVerifiedGateway(db(), SHOP, "stripe", {
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          id: "cs_x",
          payment_status: "paid",
          amount_total: 100_000,
          currency: "kzt",
          payment_intent: "pi_missing",
          metadata: { v4_order_id: missing },
        },
      },
    });
    expect(r).toBe("unapplied");
    expect((await ledger()).rows[0]!.n).toBe(0);
    const cases = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.cases where bot_id = $1 and kind = 'payment_on_closed' and status = 'open'",
      [SHOP],
    );
    expect(cases.rows[0]!.n).toBe(1);
  });
});
