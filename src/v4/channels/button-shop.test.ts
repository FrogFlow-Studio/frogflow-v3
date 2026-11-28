import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgliteV4, v4Db } from "../test/pg";
import { closeOrder, createOrder, recordPayment, refund } from "../core/money/money";
import { claimFunnelSend, listFunnels, saveFunnel } from "./funnel";

const A = "aaaaaaaa-0000-4000-8000-000000000029";
let pg: PGlite;
const asA = () => pgliteV4(pg, { botId: A });
const svc = () => pgliteV4(pg);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => pg.close());

async function buyer(): Promise<string> {
  const r = await pg.query<{ id: string }>(
    "insert into v4.buyers (bot_id, country) values ($1, 'KZ') returning id",
    [A],
  );
  return r.rows[0]!.id;
}

describe("кнопки, книга и воронка", () => {
  it("оплата пишет событие раньше слова «оплачено», чужая валюта видна отдельно", async () => {
    const pid = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Тетрадь', 'file', 10000) returning id",
        [A],
      )
    ).rows[0]!.id;
    const order = await createOrder(asA(), {
      botId: A,
      buyerId: await buyer(),
      country: "KZ",
      productIds: [pid],
      by: "bot",
    });
    if (!order.ok) throw new Error(order.code);
    const pay = await recordPayment(asA(), {
      botId: A,
      orderId: order.value.id,
      amountMinor: 10000,
      currency: "KZT",
      method: "transfer",
      externalRef: "pay-1",
      by: "test",
    });
    if (!pay.ok) throw new Error(pay.code);
    await recordPayment(asA(), {
      botId: A,
      orderId: order.value.id,
      amountMinor: 100,
      currency: "USD",
      method: "transfer",
      externalRef: "pay-usd",
      by: "test",
    });
    const events = await pg.query<{ kind: string }>(
      "select kind from v4.order_events where order_id = $1 and kind in ('payment', 'paid') order by id",
      [order.value.id],
    );
    expect(events.rows.map((r) => r.kind)).toEqual(["payment", "paid", "payment"]);
    const lines = await asA().call("money_lines", { p_bot_id: A, p_order_id: order.value.id });
    const by = Object.fromEntries(lines.map((r) => [String(r.currency), Number(r.amount_minor)]));
    expect(by).toMatchObject({ KZT: 10000, USD: 100 });
  });

  it("возврат, который снимает оплату, забирает доступ и ставит снятие с канала", async () => {
    const pid = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, title, kind, base_price_minor, term) values ($1, 'Курс', 'club', 10000, interval '30 days') returning id",
        [A],
      )
    ).rows[0]!.id;
    const order = await createOrder(asA(), {
      botId: A,
      buyerId: await buyer(),
      country: "KZ",
      productIds: [pid],
      by: "bot",
    });
    if (!order.ok) throw new Error(order.code);
    await recordPayment(asA(), {
      botId: A,
      orderId: order.value.id,
      amountMinor: 20000,
      currency: "KZT",
      method: "transfer",
      externalRef: "club-pay",
      by: "test",
    });
    const keep = await refund(asA(), {
      botId: A,
      orderId: order.value.id,
      amountMinor: 1000,
      reason: "часть",
      externalRef: "club-part",
      by: "seller",
    });
    if (!keep.ok) throw new Error(keep.code);
    const still = await pg.query<{ status: string }>(
      "select status from v4.access where order_id = $1",
      [order.value.id],
    );
    expect(still.rows.map((r) => r.status)).toEqual(["active"]);
    const full = await refund(asA(), {
      botId: A,
      orderId: order.value.id,
      amountMinor: 19000,
      reason: "возврат курса",
      externalRef: "club-full",
      by: "seller",
    });
    if (!full.ok) throw new Error(full.code);
    const gone = await pg.query<{ status: string }>(
      "select status from v4.access where order_id = $1",
      [order.value.id],
    );
    expect(gone.rows.map((r) => r.status)).toEqual(["revoked"]);
    const jobs = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.jobs where bot_id = $1 and kind = 'club_remove'",
      [A],
    );
    expect(jobs.rows[0]!.n).toBe(1);
  });

  it("остаток списывается при заказе и возвращается один раз при отмене", async () => {
    const pid = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, title, kind, base_price_minor, track_stock) values ($1, 'Букет', 'file', 5000, true) returning id",
        [A],
      )
    ).rows[0]!.id;
    await asA().call("move_stock", {
      p_bot_id: A,
      p_product_id: pid,
      p_delta: 2,
      p_reason: "receipt",
      p_external_ref: "in-1",
      p_created_by: "seller",
    });
    const b = await buyer();
    const placed = await asA().call("place_order", {
      p_bot_id: A,
      p_buyer_id: b,
      p_country: "KZ",
      p_product_ids: [pid],
      p_created_by: "bot",
    });
    const orderId = String((placed[0] as { id: string }).id);
    const mid = await asA().call("stock_on_hand", { p_bot_id: A, p_product_id: pid });
    expect(Number(mid[0]?.stock_on_hand)).toBe(1);
    const closed = await closeOrder(asA(), {
      botId: A,
      orderId,
      status: "cancelled",
      reason: "передумал",
      by: "buyer",
    });
    if (!closed.ok) throw new Error(closed.code);
    await closeOrder(asA(), {
      botId: A,
      orderId,
      status: "cancelled",
      reason: "ещё раз",
      by: "buyer",
    });
    const back = await asA().call("stock_on_hand", { p_bot_id: A, p_product_id: pid });
    expect(Number(back[0]?.stock_on_hand)).toBe(2);
    await asA().call("set_fulfillment", {
      p_bot_id: A,
      p_order_id: orderId,
      p_on: "2026-11-29",
      p_zone: "center",
      p_address: "Абая 1",
      p_flower: { urgency: "later", slot: "evening", note: "открытка маме" },
    });
    const flower = await pg.query<{ flower: { slot: string } }>(
      "select flower from v4.orders where id = $1",
      [orderId],
    );
    expect(flower.rows[0]!.flower.slot).toBe("evening");
  });

  it("урок дважды с одной позицией получает два номера", async () => {
    const pid = (
      await pg.query<{ id: string }>(
        "insert into v4.products (bot_id, title, kind, base_price_minor) values ($1, 'Клуб', 'club', 1000) returning id",
        [A],
      )
    ).rows[0]!.id;
    await asA().call("add_lesson", {
      p_bot_id: A,
      p_product_id: pid,
      p_title: "Первый",
      p_position: 1,
    });
    await asA().call("add_lesson", {
      p_bot_id: A,
      p_product_id: pid,
      p_title: "Снова первый",
      p_position: 1,
    });
    const pos = await pg.query<{ position: number }>(
      "select position from v4.lessons where product_id = $1 order by position",
      [pid],
    );
    expect(pos.rows.map((r) => r.position)).toEqual([1, 2]);
  });

  it("воронка не двоит шаги, повтор отправки не заявляется, напоминание одно", async () => {
    const first = await saveFunnel(asA(), {
      botId: A,
      name: "Старт",
      triggerKind: "comment",
      triggerValue: "хочу",
      steps: [{ kind: "card", payload: { title: "Палитра" } }, { kind: "case" }],
    });
    expect(first.saved).toBe(true);
    const again = await saveFunnel(asA(), {
      botId: A,
      name: "Старт",
      triggerKind: "comment",
      triggerValue: "хочу",
      funnelId: first.id,
      rev: first.rev,
      steps: [
        { kind: "card", payload: { title: "Палитра" } },
        { kind: "wait", payload: { hours: 1 } },
      ],
    });
    expect(again.saved).toBe(true);
    const stale = await saveFunnel(asA(), {
      botId: A,
      name: "Старт",
      triggerKind: "comment",
      triggerValue: "хочу",
      funnelId: first.id,
      rev: first.rev,
      steps: [{ kind: "case" }],
    });
    expect(stale.saved).toBe(false);
    const list = await listFunnels(asA(), A);
    expect(list[0]?.steps.map((s) => s.kind)).toEqual(["card", "wait"]);
    expect(
      await claimFunnelSend(asA(), { botId: A, funnelId: first.id, externalRef: "dm:1" }),
    ).toBe(true);
    expect(
      await claimFunnelSend(asA(), { botId: A, funnelId: first.id, externalRef: "dm:1" }),
    ).toBe(false);

    const due = new Date("2026-11-28T12:00:00Z");
    const remindOrder = (
      await pg.query<{ id: string }>(
        `insert into v4.orders (bot_id, buyer_id, no, currency, subtotal_minor, total_minor, status, fulfill_on, created_by)
         values ($1, $2, 900, 'KZT', 100, 100, 'open', '2026-11-29', 'bot') returning id`,
        [A, await buyer()],
      )
    ).rows[0]!.id;
    expect(remindOrder).toBeTruthy();
    const n1 = await svc().call("remind_physical", { p_bot_id: A, p_now: due.toISOString() });
    const n2 = await svc().call("remind_physical", { p_bot_id: A, p_now: due.toISOString() });
    expect(Number(n1[0]?.remind_physical)).toBe(2);
    expect(Number(n2[0]?.remind_physical)).toBe(0);

    await asA().call("touch_buyer", {
      p_bot_id: A,
      p_channel: "instagram",
      p_external_id: "ig-1",
      p_now: "2026-11-27T00:00:00Z",
    });
    const open = await asA().call("reply_window_open", {
      p_bot_id: A,
      p_channel: "instagram",
      p_external_id: "ig-1",
      p_now: "2026-11-28T12:00:00Z",
    });
    expect(open[0]?.reply_window_open).toBe(false);
  });
});
