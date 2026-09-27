import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { linkWebOrder, linkedWebOrders, mergeOrders } from "./web-link";

/** Привязка заказа с сайта к Telegram: ядро (подпись ссылки проверяет серверная функция). */
function setup(orderPlatform = "web", ownerPlatform = "web") {
  const db = fakeDb();
  db.tables.bot_users = [
    { user_key: "web_a", platform: ownerPlatform, telegram_id: -7, state: { mode: "idle" } },
    { user_key: "tg_42", platform: "telegram", telegram_id: 42, state: { locale: "kk" } },
    { user_key: "tg_43", platform: "telegram", telegram_id: 43, state: null },
  ];
  db.tables.orders = [
    { id: 5, platform: orderPlatform, telegram_id: -7, created_at: "2026-09-01T00:00:00Z" },
    { id: 6, platform: "telegram", telegram_id: 99, created_at: "2026-09-02T00:00:00Z" },
  ];
  db.tables.order_items = [];
  const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
  return { ctx, db };
}

describe("привязка заказа с сайта", () => {
  it("состояние обоих покупателей дописывается, а не перезаписывается", async () => {
    const { ctx, db } = setup();
    expect(await linkWebOrder(ctx, 5, 42)).toBe("linked");
    expect(db.tables.bot_users![0]!.state).toEqual({
      mode: "idle",
      telegram_links: { "5": 42 },
      telegram_links_v: 1,
    });
    expect(db.tables.bot_users![1]!.state).toEqual({
      locale: "kk",
      web_orders: [5],
      web_orders_v: 1,
    });
  });

  it("двое одновременно — заказ достаётся одному", async () => {
    const { ctx } = setup();
    const r = await Promise.all([linkWebOrder(ctx, 5, 42), linkWebOrder(ctx, 5, 43)]);
    expect(r.filter((x) => x === "linked")).toHaveLength(1);
    expect(r.filter((x) => x === "taken" || x === "busy")).toHaveLength(1);
  });

  it("условие записи — счётчик поля и шаг диалога, а не весь state (431 на длинном state)", async () => {
    const { ctx, db } = setup();
    const from = db.from.bind(db);
    const eqs: string[] = [];
    (db as { from: typeof db.from }).from = ((t: string) => {
      const q = from(t);
      const eq = q.eq.bind(q);
      (q as { eq: typeof q.eq }).eq = ((c: string, v: unknown) => {
        eqs.push(c);
        return eq(c, v);
      }) as typeof q.eq;
      return q;
    }) as typeof db.from;
    expect(await linkWebOrder(ctx, 5, 42)).toBe("linked");
    expect(eqs).not.toContain("state");
    expect(eqs).toContain("state->>mode");
  });

  it("шаг бота между чтением и записью не затирается: запись повторяется", async () => {
    const { ctx, db } = setup();
    const from = db.from.bind(db);
    let first = true;
    (db as { from: typeof db.from }).from = ((t: string) => {
      const q = from(t);
      const update = q.update.bind(q);
      (q as { update: typeof q.update }).update = ((row: never) => {
        if (t === "bot_users" && first) {
          first = false;
          db.tables.bot_users![0]!.state = { mode: "checkout" };
        }
        return update(row);
      }) as typeof q.update;
      return q;
    }) as typeof db.from;
    expect(await linkWebOrder(ctx, 5, 42)).toBe("linked");
    expect(db.tables.bot_users![0]!.state).toMatchObject({
      mode: "checkout",
      telegram_links: { "5": 42 },
    });
  });

  it("сбой записи (например, 431 от PostgREST) — ошибка, а не «занято»", async () => {
    const { ctx, db } = setup();
    const from = db.from.bind(db);
    (db as { from: typeof db.from }).from = ((t: string) => {
      const q = from(t);
      if (t !== "bot_users") return q;
      (q as { update: typeof q.update }).update = (() => ({
        eq: function () {
          return this;
        },
        is: function () {
          return this;
        },
        select: async () => ({
          data: null,
          error: { message: "431 Request Header Fields Too Large" },
        }),
      })) as unknown as typeof q.update;
      return q;
    }) as typeof db.from;
    await expect(linkWebOrder(ctx, 5, 42)).rejects.toThrow("431");
  });

  it("список покупателя полон — заказ не занимается", async () => {
    const { ctx, db } = setup();
    db.tables.bot_users![1]!.state = {
      web_orders: Array.from({ length: 100 }, (_, i) => 1000 + i),
    };
    expect(await linkWebOrder(ctx, 5, 42)).toBe("full");
    expect(db.tables.bot_users![0]!.state).toEqual({ mode: "idle" });
  });

  it("не заказ с сайта и заказ другого вошедшего покупателя — не привязываются", async () => {
    expect(await linkWebOrder(setup("instagram").ctx, 5, 42)).toBe("not_web");
    expect(await linkWebOrder(setup().ctx, 6, 42)).toBe("not_web");
    expect(await linkWebOrder(setup("web", "telegram").ctx, 5, 42)).toBe("taken");
  });

  it("в списке — только заказы с сайта, даже если в state чужой id", async () => {
    const { ctx } = setup();
    const got = await linkedWebOrders(ctx, { state: { web_orders: [5, 6] } });
    expect(got.map((o) => o.id)).toEqual([5]);
  });

  it("слияние без повторов, новые первыми", () => {
    const a = [{ id: 1, created_at: "2026-09-01" }];
    const b = [
      { id: 2, created_at: "2026-09-03" },
      { id: 1, created_at: "2026-09-01" },
    ];
    expect(mergeOrders(a, b).map((o) => o.id)).toEqual([2, 1]);
  });
});
