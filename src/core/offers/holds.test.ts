import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { releaseOfferHolds, reserveOfferUnits } from "./holds";
import { OFFER_ROW_MARK, soldForOffer, type LimitedOffer } from "./offers";

const BOT = "11111111-1111-1111-1111-111111111111";
const offer: LimitedOffer = {
  id: "o1",
  product_id: "p1",
  percent: 20,
  starts_at: "2026-10-04T00:00:00Z",
  ends_at: "2026-12-30T00:00:00Z",
  limit: 3,
};

/**
 * fakeDb не умеет «orders!inner» (связь многие-к-одному): запрос проданного по акции
 * разбираем здесь теми же условиями, что у `soldForOffer`; остальное — в fakeDb.
 */
function withOrdersJoin(inner: FakeDb): FakeDb["from"] {
  return (table) => {
    if (table !== "order_items") return inner.from(table);
    const f: { product?: string; since?: string; skip: string[] } = { skip: [] };
    let rng: [number, number] = [0, 999];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (_c: string, v: string) => ((f.product = v), chain),
      gte: (_c: string, v: string) => ((f.since = v), chain),
      not: (_c: string, _o: string, v: string) => (
        (f.skip = v.replace(/[()]/g, "").split(",")),
        chain
      ),
      order: () => chain,
      range: (a: number, b: number) => ((rng = [a, b]), chain),
      then: (ok: (r: unknown) => unknown) => {
        const rows = (inner.tables.order_items ?? [])
          .filter((r) => r.product_id === f.product)
          .map((r) => ({
            ...r,
            orders: (inner.tables.orders ?? []).find((o) => o.id === r.order_id) ?? null,
          }))
          .filter((r) => {
            const o = r.orders as { status: string; created_at: string } | null;
            return o && o.created_at >= f.since! && !f.skip.includes(o.status);
          })
          .slice(rng[0], rng[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(ok);
      },
    };
    return chain as never;
  };
}

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const ctx = {
    tenant: { id: BOT },
    db: { from: withOrdersJoin(db) },
  } as unknown as TenantContext;
  return { db, ctx };
}

let orderId = 0;
/** Заказ по настоящему пути: занять штуки → записать позиции (с меткой акции) → снять занятие. */
async function place(ctx: TenantContext, db: FakeDb, want: number) {
  const id = ++orderId;
  const token = `t${id}`;
  const granted = (await reserveOfferUnits(ctx, token, [{ offer, want }])).get("o1") ?? 0;
  // Запись заказа не мгновенна: именно в этом окне второй заказ видел бы тот же остаток.
  await new Promise((r) => setTimeout(r, 5));
  db.tables.orders = [
    ...(db.tables.orders ?? []),
    { id, bot_id: BOT, status: "awaiting_payment", created_at: "2026-10-05T10:00:00Z" },
  ];
  const rest = want - granted;
  const items = [
    ...(granted > 0 ? [{ name_snapshot: `Товар ${OFFER_ROW_MARK}`, quantity: granted }] : []),
    ...(rest > 0 ? [{ name_snapshot: "Товар", quantity: rest }] : []),
  ];
  for (const it of items)
    db.tables.order_items = [
      ...(db.tables.order_items ?? []),
      { id: `${id}-${it.name_snapshot}`, bot_id: BOT, order_id: id, product_id: "p1", ...it },
    ];
  await releaseOfferHolds(ctx, token);
  return granted;
}

describe("лимит штук по акции: занятие остатка", () => {
  it("два одновременных заказа на последнюю штуку: акцию получает один", async () => {
    for (let i = 0; i < 20; i++) {
      const { db, ctx } = setup();
      // Осталась одна штука: две уже проданы по акции.
      db.tables.orders = [
        { id: 900, bot_id: BOT, status: "paid", created_at: "2026-10-05T09:00:00Z" },
      ];
      db.tables.order_items = [
        {
          id: "x1",
          bot_id: BOT,
          order_id: 900,
          product_id: "p1",
          name_snapshot: `Товар ${OFFER_ROW_MARK}`,
          quantity: 2,
        },
      ];
      const got = await Promise.all([place(ctx, db, 1), place(ctx, db, 1)]);
      expect(got[0]! + got[1]!).toBe(1);
      expect(await soldForOffer(ctx, offer)).toBe(3);
    }
  });

  it("корзина больше остатка: по акции только остаток, остальное по полной и в лимит не идёт", async () => {
    const { db, ctx } = setup();
    expect(await place(ctx, db, 5)).toBe(3);
    expect(await soldForOffer(ctx, offer)).toBe(3);
    // Лимит выбран: следующий заказ ничего по акции не получает.
    expect(await place(ctx, db, 2)).toBe(0);
    expect(await soldForOffer(ctx, offer)).toBe(3);
  });

  it("отменённый заказ возвращает штуки акции; занятие снимается, а брошенное гаснет само", async () => {
    const { db, ctx } = setup();
    await place(ctx, db, 3);
    expect(await place(ctx, db, 1)).toBe(0);
    db.tables.orders![0]!.status = "cancelled";
    expect(await place(ctx, db, 2)).toBe(2);
    // Занятие без снятия (оформление оборвалось) держит штуки, пока не истечёт срок.
    const t = Date.now();
    await reserveOfferUnits(ctx, "ghost", [{ offer, want: 1 }]);
    expect((await reserveOfferUnits(ctx, "next", [{ offer, want: 1 }])).get("o1")).toBe(0);
    const row = db.tables.app_settings!.find((r) => r.key === "offer_holds")!;
    const parsed = JSON.parse(row.value as string);
    for (const h of Object.values(parsed.h) as Array<{ t: number }>) h.t = t - 10 * 60_000;
    row.value = JSON.stringify(parsed);
    expect((await reserveOfferUnits(ctx, "later", [{ offer, want: 1 }])).get("o1")).toBe(1);
  });

  it("старые заказы без метки считаются целиком, новые — только позиции с меткой", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 1, bot_id: BOT, status: "paid", created_at: "2026-10-03T12:00:00Z" }];
    db.tables.order_items = [
      { id: "a", bot_id: BOT, order_id: 1, product_id: "p1", name_snapshot: "Товар", quantity: 1 },
    ];
    expect(await soldForOffer(ctx, { ...offer, starts_at: "2026-10-01T00:00:00Z" })).toBe(1);
  });

  it("«🔥» в названии товара не меняет счёт: 3 по акции и 2 по полной — продано 3", async () => {
    const { db, ctx } = setup();
    db.tables.orders = [{ id: 1, bot_id: BOT, status: "paid", created_at: "2026-10-05T09:00:00Z" }];
    db.tables.order_items = [
      {
        id: "a",
        bot_id: BOT,
        order_id: 1,
        product_id: "p1",
        name_snapshot: `Хит 🔥 ${OFFER_ROW_MARK}`,
        quantity: 3,
      },
      { id: "b", bot_id: BOT, order_id: 1, product_id: "p1", name_snapshot: "Хит 🔥", quantity: 2 },
    ];
    expect(await soldForOffer(ctx, offer)).toBe(3);
    // Остаток акции не съеден «остальными» штуками: лимит 3 — свободного нет, но и вдвое раньше не кончился.
    expect(await place(ctx, db, 1)).toBe(0);
  });
});
