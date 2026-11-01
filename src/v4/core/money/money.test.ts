import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../../test/pg";
import {
  closeOrder,
  createOrder,
  decideReceipt,
  expireOrders,
  LEDGER_KINDS,
  LEDGER_METHODS,
  methodsFor,
  ORDER_STATUSES,
  orderMoney,
  PAYMENT_METHOD_KINDS,
  RECEIPT_STATUSES,
  recordChargeback,
  recordPayment,
  refund,
  submitReceipt,
} from "./money";

/**
 * Книга денег v4 на настоящем Postgres (PGlite) с миграциями v4.
 * Примеры — из разборов клиентов: №228 Копилки (недоплата 1 225 ₸),
 * AATeach (цены в рублях), чеки, возвраты.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const fp = (n: number) => n.toString(16).padStart(64, "0");

let pg: PGlite;
const svc = () => pgliteV4(pg);
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });

async function seedShop(bot: string, base = "KZT", earn = 0, redeem = 0) {
  await pg.query(
    "insert into v4.shops (bot_id, base_currency, points_earn_pct, points_redeem_pct) values ($1, $2, $3, $4)",
    [bot, base, earn, redeem],
  );
}
async function buyer(bot: string, country = "KZ"): Promise<string> {
  const r = await pg.query<{ id: string }>(
    "insert into v4.buyers (bot_id, country) values ($1, $2) returning id",
    [bot, country],
  );
  return r.rows[0]!.id;
}
async function product(bot: string, title: string, priceMinor: number): Promise<string> {
  const r = await pg.query<{ id: string }>(
    "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, $2, 'file', $3) returning id",
    [bot, title, priceMinor],
  );
  return r.rows[0]!.id;
}
async function order(bot: string, buyerId: string, productIds: string[], extra = {}) {
  const r = await createOrder(asA(), {
    botId: bot,
    buyerId,
    country: "KZ",
    productIds,
    by: "bot",
    ...extra,
  });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}
async function pay(
  orderId: string,
  amountMinor: number,
  ref: string,
  method = "transfer" as const,
  currency = "KZT",
) {
  const r = await recordPayment(asA(), {
    botId: A,
    orderId,
    amountMinor,
    currency,
    method,
    externalRef: ref,
    by: "test",
  });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}
const money = async (orderId: string) => (await orderMoney(asA(), A, orderId))!;

let p3000: string;
let p500: string;

beforeAll(async () => {
  pg = await v4Db();
  await seedShop(A, "KZT", 5, 50);
  await seedShop(B);
  p3000 = await product(A, "Рабочая тетрадь 5 класс", 300_000);
  p500 = await product(A, "Плакат", 50_000);
});
afterAll(async () => pg.close());

describe("статусы в TS и в базе — один список (решение 70)", () => {
  const checkValues = async (table: string, column: string) => {
    const r = await pg.query<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
       join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'v4' and t.relname = $1 and c.contype = 'c'`,
      [table],
    );
    const def = r.rows
      .map((x) => x.def)
      .find((d) =>
        new RegExp(`\\(${column} = ANY|${column}\\)::text = ANY|\\(\\(${column}`).test(d),
      );
    return [...(def ?? "").matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
  };
  it.each([
    ["orders", "status", ORDER_STATUSES],
    ["ledger", "kind", LEDGER_KINDS],
    ["ledger", "method", LEDGER_METHODS],
    ["payment_methods", "kind", PAYMENT_METHOD_KINDS],
    ["receipts", "status", RECEIPT_STATUSES],
  ] as const)("%s.%s", async (table, column, list) => {
    expect(await checkValues(table, column)).toEqual([...list].sort());
  });
});

describe("цена в валюте страны покупателя (решение 91)", () => {
  it("своя цена товара в рублях, курс продавца для сомов, иначе базовая валюта", async () => {
    const pid = await product(A, "Прописи", 150_000);
    await pg.query(
      "insert into v4.product_prices (bot_id, product_id, currency, amount_minor) values ($1, $2, 'RUB', 29000)",
      [A, pid],
    );
    await pg.query(
      "insert into v4.fx_rates (bot_id, currency, units_per_base) values ($1, 'KGS', 0.1745)",
      [A],
    );
    const b = await buyer(A, "RU");
    const ru = await createOrder(asA(), {
      botId: A,
      buyerId: b,
      country: "RU",
      productIds: [pid],
      by: "bot",
    });
    const kg = await createOrder(asA(), {
      botId: A,
      buyerId: b,
      country: "KG",
      productIds: [pid],
      by: "bot",
    });
    const de = await createOrder(asA(), {
      botId: A,
      buyerId: b,
      country: "DE",
      productIds: [pid],
      by: "bot",
    });
    expect(ru.ok && [ru.value.currency, ru.value.totalMinor]).toEqual(["RUB", 29000]);
    // 1500 ₸ × 0.1745 = 261.75 → вверх до целого: 262 сома
    expect(kg.ok && [kg.value.currency, kg.value.totalMinor]).toEqual(["KGS", 26200]);
    expect(de.ok && [de.value.currency, de.value.totalMinor]).toEqual(["KZT", 150000]);
  });

  it("если хоть один товар не оценён в валюте страны — весь заказ в базовой", async () => {
    const b = await buyer(A, "RU");
    const pid = (
      await pg.query<{ id: string }>(
        "select product_id as id from v4.product_prices where currency = 'RUB' limit 1",
      )
    ).rows[0]!.id;
    const r = await createOrder(asA(), {
      botId: A,
      buyerId: b,
      country: "RU",
      productIds: [pid, p500],
      by: "bot",
    });
    expect(r.ok && [r.value.currency, r.value.totalMinor]).toEqual(["KZT", 200000]);
  });

  it("архивный или чужой товар не продаётся", async () => {
    const b = await buyer(A);
    const foreign = await product(B, "Чужой", 100);
    expect(
      await createOrder(asA(), {
        botId: A,
        buyerId: b,
        country: "KZ",
        productIds: [foreign],
        by: "bot",
      }),
    ).toEqual({ ok: false, code: "product_unavailable" });
    expect(
      await createOrder(asA(), { botId: A, buyerId: b, country: "KZ", productIds: [], by: "bot" }),
    ).toEqual({ ok: false, code: "empty_order" });
  });
});

describe("номера заказов", () => {
  it("растут по одному в пределах магазина, у другого магазина свои", async () => {
    const a1 = await order(A, await buyer(A), [p500]);
    const a2 = await order(A, await buyer(A), [p500]);
    const bProd = await product(B, "Б", 1000);
    const b1 = await createOrder(asB(), {
      botId: B,
      buyerId: await buyer(B),
      country: "KZ",
      productIds: [bProd],
      by: "bot",
    });
    expect(a2.no).toBe(a1.no + 1);
    expect(b1.ok && b1.value.no).toBe(1);
  });
});

describe("заказ и платёж — разные записи (решение 1)", () => {
  it("№228: недоплата видна как долг 1 225 ₸, доплата закрывает заказ ровно один раз", async () => {
    const o = await order(A, await buyer(A), [p3000]);
    const first = await pay(o.id, 177_500, "kaspi-1");
    expect(first).toMatchObject({ becamePaid: false, paidMinor: 177_500, dueMinor: 122_500 });
    expect(await money(o.id)).toMatchObject({ state: "partial", dueMinor: 122_500 });

    const second = await pay(o.id, 122_500, "kaspi-2");
    expect(second).toMatchObject({ becamePaid: true, dueMinor: 0 });
    // повтор того же платежа (вебхук пришёл дважды) — та же запись, сумма не удвоилась
    const again = await pay(o.id, 122_500, "kaspi-2");
    expect(again).toMatchObject({
      duplicate: true,
      becamePaid: false,
      entryId: second.entryId,
      paidMinor: 300_000,
    });
    expect(await money(o.id)).toMatchObject({ state: "paid", paidMinor: 300_000 });
    const events = await pg.query<{ kind: string }>(
      "select kind from v4.order_events where order_id = $1 order by id",
      [o.id],
    );
    expect(events.rows.map((e) => e.kind)).toEqual([
      "created",
      "payment",
      "payment",
      "paid",
      "fulfilled",
    ]);
  });

  it("переплата видна и пишется событием", async () => {
    const o = await order(A, await buyer(A), [p500]);
    await pay(o.id, 60_000, "over-1");
    expect(await money(o.id)).toMatchObject({ state: "overpaid", paidMinor: 60_000, dueMinor: 0 });
    const ev = await pg.query(
      "select detail from v4.order_events where order_id = $1 and kind = 'overpaid'",
      [o.id],
    );
    expect(ev.rows).toEqual([{ detail: { over_minor: 10_000 } }]);
  });

  it("платёж в другой валюте записан, но в «оплачено» не засчитан", async () => {
    const o = await order(A, await buyer(A), [p500]);
    const r = await pay(o.id, 9000, "rub-1", "transfer", "RUB");
    expect(r).toMatchObject({ currencyMismatch: true, becamePaid: false, paidMinor: 0 });
    expect(await money(o.id)).toMatchObject({ state: "unpaid", otherCurrency: true });
  });

  it("деньги по истёкшему заказу принимаются и помечаются", async () => {
    const o = await order(A, await buyer(A), [p500]);
    await closeOrder(asA(), {
      botId: A,
      orderId: o.id,
      status: "expired",
      reason: "тест",
      by: "test",
    });
    const r = await pay(o.id, 50_000, "late-1");
    expect(r).toMatchObject({ orderClosed: true, becamePaid: true });
    const ev = await pg.query(
      "select 1 from v4.order_events where order_id = $1 and kind = 'payment_on_closed'",
      [o.id],
    );
    expect(ev.rows).toHaveLength(1);
  });

  it("комиссия платформы — только с автооплат, отдельной строкой, «оплачено» не уменьшает (53)", async () => {
    await pg.query(
      "insert into v4.payment_methods (bot_id, kind, country, currency, fee_bp) values ($1, 'apipay', 'KZ', 'KZT', 1000)",
      [A],
    );
    const auto = await order(A, await buyer(A), [p500]);
    const manual = await order(A, await buyer(A), [p500]);
    await pay(auto.id, 50_000, "apipay-1", "apipay" as never);
    await pay(manual.id, 50_000, "tr-1");
    const fees = await pg.query<{ order_id: string; amount_minor: string }>(
      "select order_id, amount_minor::text from v4.ledger where kind = 'platform_fee' and order_id = any($1)",
      [[auto.id, manual.id]],
    );
    expect(fees.rows).toEqual([{ order_id: auto.id, amount_minor: "-5000" }]);
    expect(await money(auto.id)).toMatchObject({ state: "paid", paidMinor: 50_000 });
  });

  it("сумма платежа должна быть больше нуля", async () => {
    const o = await order(A, await buyer(A), [p500]);
    expect(
      await recordPayment(asA(), {
        botId: A,
        orderId: o.id,
        amountMinor: 0,
        currency: "KZT",
        method: "manual",
        externalRef: "z",
        by: "t",
      }),
    ).toEqual({ ok: false, code: "amount_not_positive" });
  });
});

describe("книга только дописывается", () => {
  it("изменить или удалить запись нельзя даже сервисной роли", async () => {
    const o = await order(A, await buyer(A), [p500]);
    const { entryId } = await pay(o.id, 50_000, "immut-1");
    await expect(
      pg.query("update v4.ledger set amount_minor = 1 where id = $1", [entryId]),
    ).rejects.toThrow(/v4:append_only/);
    await expect(pg.query("delete from v4.ledger where id = $1", [entryId])).rejects.toThrow(
      /v4:append_only/,
    );
  });
});

describe("возврат и отмена оплаты (решения 51, 54)", () => {
  it("возврат 475 ₸: минус в книге, заказ снова с долгом, баллы за заказ сняты", async () => {
    const b = await buyer(A);
    const o = await order(A, b, [p3000]);
    await pay(o.id, 300_000, "full-1");
    // 5% от 3000 ₸ = 150 баллов
    expect((await pg.query("select v4.points_balance($1, $2) as b", [A, b])).rows).toEqual([
      { b: 150 },
    ]);
    const r = await refund(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 47_500,
      reason: "Не тот класс",
      externalRef: "refund-click-1",
      by: "seller",
    });
    expect(r.ok).toBe(true);
    expect(await money(o.id)).toMatchObject({ state: "partial", paidMinor: 252_500 });
    expect((await pg.query("select v4.points_balance($1, $2) as b", [A, b])).rows).toEqual([
      { b: 0 },
    ]);
    // двойной клик «Вернуть» — та же запись
    const again = await refund(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 47_500,
      reason: "Не тот класс",
      externalRef: "refund-click-1",
      by: "seller",
    });
    expect(again).toEqual(r);
    expect(await money(o.id)).toMatchObject({ paidMinor: 252_500 });
  });

  it("вернуть больше оплаченного нельзя, причина обязательна", async () => {
    const o = await order(A, await buyer(A), [p500]);
    await pay(o.id, 20_000, "part-r");
    expect(
      await refund(asA(), {
        botId: A,
        orderId: o.id,
        amountMinor: 30_000,
        reason: "x",
        externalRef: "r2",
        by: "s",
      }),
    ).toEqual({ ok: false, code: "refund_exceeds_paid" });
    expect(
      await refund(asA(), {
        botId: A,
        orderId: o.id,
        amountMinor: 1000,
        reason: "",
        externalRef: "r3",
        by: "s",
      }),
    ).toEqual({ ok: false, code: "reason_required" });
  });

  it("отмена оплаты картой: минус в книге, повтор вебхука не удваивает", async () => {
    const o = await order(A, await buyer(A), [p500]);
    await pay(o.id, 50_000, "pd-1", "prodamus" as never);
    const c1 = await recordChargeback(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 50_000,
      currency: "KZT",
      method: "prodamus",
      externalRef: "pd-1",
      by: "webhook",
    });
    const c2 = await recordChargeback(asA(), {
      botId: A,
      orderId: o.id,
      amountMinor: 50_000,
      currency: "KZT",
      method: "prodamus",
      externalRef: "pd-1",
      by: "webhook",
    });
    expect(c1).toEqual(c2);
    expect(await money(o.id)).toMatchObject({ state: "unpaid", paidMinor: 0 });
  });
});

describe("чеки переводов (решения 3, 21, 55)", () => {
  it("тот же чек во втором заказе помечается номером первого", async () => {
    const o1 = await order(A, await buyer(A), [p500]);
    const o2 = await order(A, await buyer(A), [p500]);
    const r1 = await submitReceipt(asA(), {
      botId: A,
      orderId: o1.id,
      storagePath: `${A}/r1.jpg`,
      fingerprint: fp(1),
    });
    const r2 = await submitReceipt(asA(), {
      botId: A,
      orderId: o2.id,
      storagePath: `${A}/r2.jpg`,
      fingerprint: fp(1),
    });
    expect(r1.ok && r1.value.suspiciousReason).toBeNull();
    expect(r2.ok && r2.value.suspiciousReason).toBe(`тот же чек уже был в заказе №${o1.no}`);
    const keep = await pg.query(
      "select purge_after - submitted_at as d from v4.receipts where order_id = $1",
      [o1.id],
    );
    expect(String((keep.rows[0] as { d: unknown }).d)).toMatch(/1 year|365 days|years: 1/);
  });

  it("принять чек дважды (двойной клик, продавец и оператор) — один платёж", async () => {
    const o = await order(A, await buyer(A), [p500]);
    const r = await submitReceipt(asA(), {
      botId: A,
      orderId: o.id,
      storagePath: `${A}/r3.jpg`,
      fingerprint: fp(3),
    });
    if (!r.ok) throw new Error(r.code);
    const d1 = await decideReceipt(asA(), {
      botId: A,
      receiptId: r.value.id,
      accept: true,
      amountMinor: 50_000,
      by: "seller",
    });
    const d2 = await decideReceipt(asA(), {
      botId: A,
      receiptId: r.value.id,
      accept: true,
      amountMinor: 50_000,
      by: "operator",
    });
    expect(d1).toEqual({
      ok: true,
      value: { decided: true, status: "accepted", becamePaid: true },
    });
    expect(d2).toEqual({
      ok: true,
      value: { decided: false, status: "accepted", becamePaid: false },
    });
    expect(await money(o.id)).toMatchObject({ state: "paid", paidMinor: 50_000 });
  });

  it("отклонить можно только с причиной", async () => {
    const o = await order(A, await buyer(A), [p500]);
    const r = await submitReceipt(asA(), {
      botId: A,
      orderId: o.id,
      storagePath: `${A}/r4.jpg`,
      fingerprint: fp(4),
    });
    if (!r.ok) throw new Error(r.code);
    expect(
      await decideReceipt(asA(), {
        botId: A,
        receiptId: r.value.id,
        accept: false,
        reason: "",
        by: "s",
      }),
    ).toEqual({ ok: false, code: "reason_required" });
    expect(
      await decideReceipt(asA(), {
        botId: A,
        receiptId: r.value.id,
        accept: false,
        reason: "Сумма не та",
        by: "s",
      }),
    ).toMatchObject({ ok: true, value: { status: "rejected" } });
  });
});

describe("истечение через 7 дней — ничего не удаляется (решение 2)", () => {
  it("истекает только неоплаченный без чека; баллы возвращаются; строки на месте", async () => {
    const b = await buyer(A);
    await pg.query(
      "insert into v4.points (bot_id, buyer_id, kind, delta, created_by) values ($1, $2, 'migrated', 100, 'test')",
      [A, b],
    );
    const unpaid = await order(A, b, [p500], { points: 100 });
    const partial = await order(A, await buyer(A), [p500]);
    const withReceipt = await order(A, await buyer(A), [p500]);
    await pay(partial.id, 10_000, "exp-part");
    await submitReceipt(asA(), {
      botId: A,
      orderId: withReceipt.id,
      storagePath: `${A}/r5.jpg`,
      fingerprint: fp(5),
    });
    const before = (await pg.query("select count(*)::int as n from v4.orders")).rows;

    const in8days = new Date(Date.now() + 8 * 86_400_000);
    expect(await expireOrders(svc(), A, new Date())).toBe(0);
    const n = await expireOrders(svc(), A, in8days);
    expect(n).toBeGreaterThanOrEqual(1);
    const st = await pg.query<{ id: string; status: string }>(
      "select id, status from v4.orders where id = any($1)",
      [[unpaid.id, partial.id, withReceipt.id]],
    );
    const byId = Object.fromEntries(st.rows.map((r) => [r.id, r.status]));
    expect(byId).toEqual({
      [unpaid.id]: "expired",
      [partial.id]: "open",
      [withReceipt.id]: "open",
    });
    expect((await pg.query("select v4.points_balance($1, $2) as b", [A, b])).rows).toEqual([
      { b: 100 },
    ]);
    expect((await pg.query("select count(*)::int as n from v4.orders")).rows).toEqual(before);
    // повторный прогон крона ничего не меняет
    await expireOrders(svc(), A, in8days);
    expect(
      (
        await pg.query(
          "select count(*)::int as n from v4.points where order_id = $1 and kind = 'redeem_return'",
          [unpaid.id],
        )
      ).rows,
    ).toEqual([{ n: 1 }]);
  });
});

describe("баллы (решение 93)", () => {
  it("списать не больше баланса и не больше % магазина", async () => {
    const b = await buyer(A);
    await pg.query(
      "insert into v4.points (bot_id, buyer_id, kind, delta, created_by) values ($1, $2, 'migrated', 2000, 'test')",
      [A, b],
    );
    // 50% от 500 ₸ = 250 баллов максимум
    expect(
      await createOrder(asA(), {
        botId: A,
        buyerId: b,
        country: "KZ",
        productIds: [p500],
        points: 300,
        by: "bot",
      }),
    ).toEqual({ ok: false, code: "points_exceed_limit" });
    expect(
      await createOrder(asA(), {
        botId: A,
        buyerId: b,
        country: "KZ",
        productIds: [p500],
        points: 3000,
        by: "bot",
      }),
    ).toEqual({ ok: false, code: "points_exceed_balance" });
    const ok = await order(A, b, [p500], { points: 250 });
    expect([ok.totalMinor, ok.pointsDiscountMinor]).toEqual([25_000, 25_000]);
  });

  it("пробный заказ баллов не даёт и в выписку не попадает (31)", async () => {
    const b = await buyer(A);
    const o = await order(A, b, [p3000], { isTest: true });
    await pay(o.id, 300_000, "test-order-1");
    expect((await pg.query("select v4.points_balance($1, $2) as b", [A, b])).rows).toEqual([
      { b: 0 },
    ]);
    const all = await pg.query<{ s: string }>(
      "select coalesce(sum(amount_minor), 0)::text as s from v4.daily_totals where bot_id = $1 and kind = 'payment'",
      [A],
    );
    const real = await pg.query<{ s: string }>(
      "select coalesce(sum(l.amount_minor), 0)::text as s from v4.ledger l join v4.orders o on o.id = l.order_id where l.bot_id = $1 and l.kind = 'payment' and not o.is_test",
      [A],
    );
    expect(all.rows[0]!.s).toBe(real.rows[0]!.s);
  });
});

describe("способы оплаты по стране (решения 4, 92)", () => {
  it("перевод — только там, где есть реквизиты; автооплата без страны — везде", async () => {
    await pg.query(
      `insert into v4.payment_methods (bot_id, kind, country, currency, details) values
        ($1, 'transfer', 'KZ', 'KZT', 'Kaspi 4400…'), ($1, 'transfer', 'UZ', 'UZS', 'Humo 9860…'),
        ($1, 'robokassa', null, 'KZT', '')`,
      [B],
    );
    expect((await methodsFor(asB(), B, "UZ")).map((m) => `${m.kind}:${m.currency}`)).toEqual([
      "robokassa:KZT",
      "transfer:UZS",
    ]);
    expect((await methodsFor(asB(), B, "BY")).map((m) => m.kind)).toEqual(["robokassa"]);
    expect(await methodsFor(asA(), B, "UZ")).toEqual([]);
  });
});

describe("изоляция арендаторов (роль tenant_bot, RLS)", () => {
  it("чужой заказ не виден и не оплачивается", async () => {
    const o = await order(A, await buyer(A), [p500]);
    expect(
      await recordPayment(asB(), {
        botId: A,
        orderId: o.id,
        amountMinor: 50_000,
        currency: "KZT",
        method: "manual",
        externalRef: "steal",
        by: "x",
      }),
    ).toEqual({ ok: false, code: "order_not_found" });
    expect(await orderMoney(asB(), A, o.id)).toBeNull();
  });

  it("арендатор не удаляет заказы, не меняет сумму и не пишет счета платформы", async () => {
    const o = await order(A, await buyer(A), [p500]);
    const asTenant = async (sql: string, params: unknown[] = []) =>
      pg.transaction(async (tx) => {
        await tx.query("set local role tenant_bot");
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ bot_id: A }),
        ]);
        return tx.query(sql, params);
      });
    await expect(asTenant("delete from v4.orders where id = $1", [o.id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asTenant("update v4.orders set total_minor = 1, subtotal_minor = 1 where id = $1", [o.id]),
    ).rejects.toThrow(/permission denied/);
    const inv = await pg.query<{ id: string }>(
      "insert into v4.invoices (bot_id, period, tariff, tariff_minor, currency) values ($1, '2026-12-01', 'pro', 1990000, 'KZT') returning id",
      [A],
    );
    await expect(
      asTenant(
        "insert into v4.ledger (bot_id, book, invoice_id, kind, amount_minor, currency, method, external_ref, created_by) values ($1, 'billing', $2, 'payment', 1990000, 'KZT', 'manual', 'fake-invoice', 'x')",
        [A, inv.rows[0]!.id],
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
