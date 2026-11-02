import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botMayReply, handToSeller, openCase } from "../core/cases/cases";
import { createOrder, orderMoney, submitReceipt } from "../core/money/money";
import { pgliteV4, v4Db } from "../test/pg";
import { caseAction, shopReady } from "./actions";
import { today } from "./screens";

/**
 * Кнопки «Сегодня (v4)» на настоящем Postgres под ролью арендатора: чек
 * принят — заказ оплачен и дело закрыто; второй клик ничего не меняет;
 * «Вернуть боту» снимает передачу продавцу; чужое дело недоступно.
 */

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const NO_SHOP = "cccccccc-0000-4000-8000-0000000000c3";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
const asB = () => pgliteV4(pg, { botId: B });
let buyer: string;
let product: string;

async function receiptCase(fp: string) {
  const o = await createOrder(asA(), {
    botId: A,
    buyerId: buyer,
    country: "KZ",
    productIds: [product],
    by: "bot",
  });
  if (!o.ok) throw new Error(o.code);
  const r = await submitReceipt(asA(), {
    botId: A,
    orderId: o.value.id,
    storagePath: `r/${fp}.jpg`,
    fingerprint: fp.repeat(64).slice(0, 64),
  });
  if (!r.ok) throw new Error(r.code);
  const card = (await today(asA(), A)).cards.find(
    (c) => c.kind === "receipt_review" && c.orderId === o.value.id,
  )!;
  return { order: o.value, card };
}

beforeAll(async () => {
  pg = await v4Db();
  for (const bot of [A, B]) {
    await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [bot]);
  }
  buyer = (
    await pg.query<{ id: string }>(
      "insert into v4.buyers (bot_id, country, name) values ($1, 'KZ', 'Мария') returning id",
      [A],
    )
  ).rows[0]!.id;
  product = (
    await pg.query<{ id: string }>(
      "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Тетрадь', 'file', 450000) returning id",
      [A],
    )
  ).rows[0]!.id;
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe("магазин в v4", () => {
  it("свой есть, чужого не видно, без магазина — нет", async () => {
    expect(await shopReady(asA(), A)).toBe(true);
    expect(await shopReady(asB(), A)).toBe(false);
    expect(await shopReady(pgliteV4(pg, { botId: NO_SHOP }), NO_SHOP)).toBe(false);
  });
});

describe("кнопки дел", () => {
  it("«Деньги пришли»: заказ оплачен остатком, чек принят, дело ушло с экрана; второй клик — already", async () => {
    const { order, card } = await receiptCase("a");
    expect(card.receiptId).toBeTruthy();
    const r = await caseAction(asA(), {
      botId: A,
      caseId: card.id,
      action: "receipt_accept",
      by: "admin:owner",
    });
    expect(r).toEqual({ ok: true, becamePaid: true });
    const m = await orderMoney(asA(), A, order.id);
    expect(m).toMatchObject({ paidMinor: 450000, dueMinor: 0, state: "paid" });
    const ev = await pg.query<{ kind: string; amount: string | null }>(
      "select kind, detail->>'amount_minor' amount from v4.order_events where order_id = $1 and kind = 'receipt_accepted'",
      [order.id],
    );
    expect(ev.rows).toEqual([{ kind: "receipt_accepted", amount: "450000" }]);
    expect((await today(asA(), A)).cards.some((c) => c.id === card.id)).toBe(false);
    expect(
      await caseAction(asA(), { botId: A, caseId: card.id, action: "receipt_accept", by: "x" }),
    ).toEqual({ ok: false, code: "case_not_found" });
    const pays = await pg.query("select 1 from v4.ledger where order_id = $1", [order.id]);
    expect(pays.rows).toHaveLength(1);
  });

  it("два клика одновременно — один платёж", async () => {
    const { order, card } = await receiptCase("b");
    const both = await Promise.all(
      [1, 2].map(() =>
        caseAction(asA(), { botId: A, caseId: card.id, action: "receipt_accept", by: "x" }),
      ),
    );
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    const pays = await pg.query("select 1 from v4.ledger where order_id = $1", [order.id]);
    expect(pays.rows).toHaveLength(1);
  });

  it("«Не пришли» без причины — отказ, с причиной — чек отклонён, заказ не оплачен", async () => {
    const { order, card } = await receiptCase("c");
    expect(
      await caseAction(asA(), {
        botId: A,
        caseId: card.id,
        action: "receipt_reject",
        by: "x",
        reason: "  ",
      }),
    ).toEqual({ ok: false, code: "reason_required" });
    expect(
      await caseAction(asA(), {
        botId: A,
        caseId: card.id,
        action: "receipt_reject",
        by: "x",
        reason: "Денег нет в Kaspi",
      }),
    ).toEqual({ ok: true });
    expect((await orderMoney(asA(), A, order.id))?.state).toBe("unpaid");
  });

  it("«Вернуть боту» снимает передачу продавцу; к чеку эта кнопка не подходит", async () => {
    const caseId = await handToSeller(asA(), {
      botId: A,
      buyerId: buyer,
      reason: "хочет скидку",
      by: "bot",
    });
    expect(await botMayReply(asA(), A, buyer)).toBe(false);
    const { card } = await receiptCase("d");
    expect(
      await caseAction(asA(), { botId: A, caseId: card.id, action: "return_to_bot", by: "x" }),
    ).toEqual({ ok: false, code: "not_allowed" });
    expect(await caseAction(asA(), { botId: A, caseId, action: "return_to_bot", by: "x" })).toEqual(
      {
        ok: true,
      },
    );
    expect(await botMayReply(asA(), A, buyer)).toBe(true);
  });

  it("«Закрыть» закрывает дело; чужой магазин его не видит и закрыть не может", async () => {
    const ch = await openCase(asA(), {
      botId: A,
      kind: "channel_down",
      dedupeKey: "whatsapp",
      by: "watch",
    });
    if (!ch.ok) throw new Error(ch.code);
    const id = ch.value.caseId;
    expect(
      await caseAction(asB(), { botId: A, caseId: id, action: "close_case", by: "x" }),
    ).toEqual({ ok: false, code: "case_not_found" });
    expect(
      await caseAction(asA(), { botId: A, caseId: id, action: "close_case", by: "x" }),
    ).toEqual({ ok: true });
  });
});
