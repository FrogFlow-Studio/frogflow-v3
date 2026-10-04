import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isUserError } from "@/core/i18n/user-error";
import { orderIdsForFilter } from "./admin";
import { assembleOrders, BATCH_MAX, deliveryLabels, packingSlips } from "./batch";

const BOT = "00000000-0000-0000-0000-000000000001";
// Дата зашита: ночь на 6 октября по Алматы (UTC+5), в UTC ещё 5-е.
const NOW = new Date("2026-10-05T21:00:00Z");
const TODAY = "2026-10-06T00:00:00Z";
const YESTERDAY = "2026-10-05T00:00:00Z";

function shop(db: FakeDb) {
  return {
    tenant: { id: BOT, modules: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}
let seq = 0;
const order = (over: Record<string, unknown> = {}) => ({
  id: ++seq,
  bot_id: BOT,
  status: "accepted",
  fulfillment_kind: "physical",
  fulfillment_type: "delivery",
  fulfillment_address: "ул. Абая, 1",
  fulfillment_at: TODAY,
  display_name: "Анна",
  contact: "+7 700 000 00 00",
  platform: "telegram",
  telegram_id: 5,
  total: 1000,
  currency: "KZT",
  created_at: "2026-10-04T10:00:00Z",
  ...over,
});
const statuses = (db: FakeDb) => Object.fromEntries(db.tables.orders!.map((o) => [o.id, o.status]));
type Notified = { id: number; status: string };
const notifier = () => vi.fn(async (_o: Notified) => true);

describe("отметить собранными", () => {
  it("меняет только выбранные: принят и в работе → готов; остальные считаются, но не трогаются", async () => {
    const db = fakeDb();
    const a = order(),
      b = order({ status: "in_production" }),
      done = order({ status: "ready" }),
      unpaid = order({ status: "awaiting_payment" }),
      digital = order({ fulfillment_kind: "digital" }),
      notChosen = order();
    db.tables.orders = [a, b, done, unpaid, digital, notChosen];
    const notify = notifier();
    const r = await assembleOrders(
      shop(db),
      { ids: [a.id, b.id, done.id, unpaid.id, digital.id, 99999] },
      "admin:m",
      notify,
    );
    expect(r).toEqual({ assembled: 2, already: 1, skipped: 3, notNotified: 0, remaining: 0 });
    expect(statuses(db)).toEqual({
      [a.id]: "ready",
      [b.id]: "ready",
      [done.id]: "ready",
      [unpaid.id]: "awaiting_payment",
      [digital.id]: "accepted",
      [notChosen.id]: "accepted",
    });
    // Покупателю пишем только о тех, чей статус сменила эта запись, и со статусом «готов».
    expect(notify.mock.calls.map(([o]) => [o.id, o.status])).toEqual([
      [a.id, "ready"],
      [b.id, "ready"],
    ]);
    const events = db.tables.zernio_logs!.filter((e) => e.event_type === "order.status");
    expect(events).toHaveLength(2);
  });

  it("повторный клик ничего не меняет и не пишет покупателям второй раз", async () => {
    const db = fakeDb();
    const rows = [order(), order({ status: "in_production" })];
    db.tables.orders = rows;
    const ids = rows.map((o) => o.id);
    const notify = notifier();
    await assembleOrders(shop(db), { ids }, "admin:m", notify);
    const again = await assembleOrders(shop(db), { ids }, "admin:m", notify);
    expect(again).toMatchObject({ assembled: 0, already: 2 });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(db.tables.zernio_logs!.filter((e) => e.event_type === "order.status")).toHaveLength(2);
  });

  it("гонка: два окна одновременно — каждый заказ собран и сообщён один раз", async () => {
    const db = fakeDb();
    const rows = Array.from({ length: 6 }, () => order());
    db.tables.orders = rows;
    const ids = rows.map((o) => o.id);
    const notify = notifier();
    const [x, y] = await Promise.all([
      assembleOrders(shop(db), { ids }, "admin:a", notify),
      assembleOrders(shop(db), { ids }, "admin:b", notify),
    ]);
    expect(x.assembled + y.assembled).toBe(6);
    expect(x.already + y.already).toBe(6);
    expect(notify).toHaveBeenCalledTimes(6);
    expect(db.tables.zernio_logs!.filter((e) => e.event_type === "order.status")).toHaveLength(6);
  });

  it("сообщение не дошло или упало — статус сменён, это видно в итоге", async () => {
    const db = fakeDb();
    const rows = [order(), order(), order()];
    db.tables.orders = rows;
    const notify = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("telegram 500"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await assembleOrders(shop(db), { ids: rows.map((o) => o.id) }, "admin:m", notify);
    expect(r).toMatchObject({ assembled: 3, notNotified: 2 });
    expect(Object.values(statuses(db))).toEqual(["ready", "ready", "ready"]);
  });

  it("не успели за бюджет — остаток назван, обработанное не откатывается, повтор доделывает", async () => {
    const db = fakeDb();
    const rows = Array.from({ length: 5 }, () => order());
    db.tables.orders = rows;
    const ids = rows.map((o) => o.id);
    let t = 0;
    const r = await assembleOrders(shop(db), { ids }, "admin:m", notifier(), {
      budgetMs: 2,
      clock: () => t++,
    });
    expect(r.assembled + r.remaining).toBe(5);
    expect(r.remaining).toBeGreaterThan(0);
    const next = await assembleOrders(shop(db), { ids }, "admin:m", notifier());
    expect(next.assembled).toBe(r.remaining);
    expect(Object.values(statuses(db))).toEqual(Array(5).fill("ready"));
  });

  it("450 заказов сразу: чтение кусками, адрес запроса не раздувается", async () => {
    const db = fakeDb({ maxIn: 200 });
    db.tables.orders = Array.from({ length: 450 }, () => order());
    const ids = db.tables.orders.map((o) => o.id as number);
    const r = await assembleOrders(shop(db), { ids }, "admin:m", notifier());
    expect(r.assembled).toBe(450);
  });

  it("не удалось прочитать заказы — ошибка, а не «нечего собирать»", async () => {
    const db = fakeDb();
    db.tables.orders = [order()];
    const broken = withBrokenReads(db, ["orders"]);
    await expect(
      assembleOrders(
        shop(broken),
        { ids: [db.tables.orders[0]!.id as number] },
        "admin:m",
        notifier(),
      ),
    ).rejects.toThrow();
    expect(db.tables.orders[0]!.status).toBe("accepted");
  });
});

describe("«все по фильтру» и «к сборке сегодня»", () => {
  it("к сборке сегодня: сегодняшний день по поясу магазина, принят и в работе, физические", async () => {
    const db = fakeDb();
    const mine = [order(), order({ status: "in_production" })];
    db.tables.orders = [
      ...mine,
      order({ fulfillment_at: YESTERDAY }),
      order({ fulfillment_at: "2026-10-07T00:00:00Z" }),
      order({ fulfillment_at: null }),
      order({ status: "ready" }),
      order({ status: "awaiting_payment" }),
      order({ fulfillment_kind: "digital" }),
    ];
    const ids = await orderIdsForFilter(shop(db), { assembly: "today" }, NOW);
    expect(ids.sort()).toEqual(mine.map((o) => o.id).sort());
    // Днём раньше по часам магазина «сегодня» — вчерашний день.
    const early = await orderIdsForFilter(
      shop(db),
      { assembly: "today" },
      new Date("2026-10-05T10:00:00Z"),
    );
    expect(early).toHaveLength(1);
  });

  it("все по фильтру читаются постранично: 2 300 заказов — ни одного не потеряно, без повторов", async () => {
    const db = fakeDb({ maxRows: 1000 });
    db.tables.orders = Array.from({ length: 2300 }, () => order());
    db.tables.orders.push(order({ status: "delivered" }));
    const ids = await orderIdsForFilter(shop(db), { status: "accepted" }, NOW);
    expect(ids).toHaveLength(2300);
    expect(new Set(ids).size).toBe(2300);
  });

  it("не доплачено по фильтру: больше 300 заказов не обрезаются", async () => {
    const db = fakeDb({ maxIn: 200 });
    db.tables.orders = Array.from({ length: 450 }, () => order({ paid_amount: 100, total: 1000 }));
    const ids = await orderIdsForFilter(shop(db), { unpaid: true }, NOW);
    expect(ids).toHaveLength(450);
  });

  it("собрать все по фильтру — меняются только подошедшие", async () => {
    const db = fakeDb();
    const today = [order(), order()];
    const later = order({ fulfillment_at: "2026-10-09T00:00:00Z" });
    db.tables.orders = [...today, later];
    const r = await assembleOrders(
      shop(db),
      { filter: { assembly: "today" } },
      "admin:m",
      notifier(),
      {
        now: NOW,
      },
    );
    expect(r.assembled).toBe(2);
    expect(statuses(db)[later.id]).toBe("accepted");
  });

  it("чтение id по фильтру упало — ошибка, а не пустой выбор", async () => {
    const db = fakeDb();
    db.tables.orders = [order()];
    await expect(
      orderIdsForFilter(shop(withBrokenReads(db, ["orders"])), { status: "accepted" }, NOW),
    ).rejects.toThrow();
  });
});

describe("печать пачкой", () => {
  it("упаковочные листы в порядке выбора, без цен; исчезнувший заказ посчитан", async () => {
    const db = fakeDb();
    const a = order(),
      b = order();
    db.tables.orders = [a, b];
    db.tables.order_items = [
      {
        id: "i1",
        order_id: a.id,
        name_snapshot: "Торт",
        quantity: 1,
        price: 5000,
        product_id: null,
      },
      {
        id: "i2",
        order_id: b.id,
        name_snapshot: "Эклер",
        quantity: 3,
        price: 700,
        product_id: null,
      },
    ];
    const r = await packingSlips(shop(db), { ids: [b.id, a.id, 424242] });
    expect(r.slips.map((s) => s.lines[0]!.name)).toEqual(["Эклер", "Торт"]);
    expect(r.missing).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/5000|700|price|total|contact/);
  });

  it("больше предела за раз — понятный отказ с числом, а не тихая обрезка", async () => {
    const db = fakeDb();
    const ids = Array.from({ length: BATCH_MAX + 1 }, (_, i) => i + 1);
    const err = await packingSlips(shop(db), { ids }).catch((e: unknown) => e);
    expect(isUserError(err)).toBe(true);
    expect((err as { vars: Record<string, unknown> }).vars).toEqual({
      n: BATCH_MAX + 1,
      max: BATCH_MAX,
    });
    await expect(deliveryLabels(shop(db), { ids })).rejects.toThrow();
  });

  it("этикетки — только доставка с адресом; самовывоз и без адреса посчитаны отдельно", async () => {
    const db = fakeDb();
    const d = order({ display_no: 12 });
    const pickup = order({ fulfillment_type: "pickup", fulfillment_address: null });
    const noAddr = order({ fulfillment_address: "  " });
    db.tables.orders = [d, pickup, noAddr];
    const r = await deliveryLabels(shop(db), { ids: [d.id, pickup.id, noAddr.id] });
    expect(r.skipped).toBe(2);
    expect(r.labels).toEqual([
      {
        orderNo: 12,
        name: "Анна",
        phone: "+7 700 000 00 00",
        address: "ул. Абая, 1",
        date: TODAY,
        recipient: "",
      },
    ]);
  });
});
