import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { freshItems, popularItems } from "./feeds.server";
import { computePopular, refreshPopular } from "./popular.server";
import { POPULAR_KEY, buildPopular, capPerShop, parsePopular } from "./popular";

/** Ленты площадки (Л2): «Новинки» и «Часто покупают» по настоящим заказам. */
let svc: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const shops = new Map([
  ["b1", { slug: "cakes", name: "Лавка" }],
  ["b2", { slug: "flowers", name: "Сад" }],
]);
const NOW = new Date("2026-10-05T12:00:00Z");
const snap = (bot: string, id: string, extra: Record<string, unknown> = {}) => ({
  bot_id: bot,
  product_id: id,
  name: `Товар ${id}`,
  search_text: "",
  price: 100,
  currency: "KZT",
  image: null,
  updated_at: "2026-10-05T10:00:00Z",
  ...extra,
});
const product = (bot: string, id: string, day: number, extra: Record<string, unknown> = {}) => ({
  id,
  bot_id: bot,
  is_active: true,
  created_at: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`,
  ...extra,
});

beforeEach(() => {
  svc = fakeDb();
});

describe("«Новинки»", () => {
  it("самые новые первыми; скрытый товар, товар без строки снимка и скрытый магазин не показываются", async () => {
    svc.tables.products = [
      product("b1", "p1", 1),
      product("b1", "p2", 20),
      product("b1", "p3", 25, { is_active: false }),
      product("b2", "p4", 10),
      product("b1", "p5", 28), // нет в снимке: закончился
      product("hidden", "p6", 29),
    ];
    svc.tables.marketplace_items = ["p1", "p2", "p3", "p6"].map((id) =>
      snap(id === "p6" ? "hidden" : "b1", id),
    );
    svc.tables.marketplace_items!.push(snap("b2", "p4"));
    const r = await freshItems(shops, as(svc));
    expect(r.map((i) => i.id)).toEqual(["p2", "p4", "p1"]);
    expect(r[0]).toMatchObject({ shopSlug: "cakes", shopName: "Лавка", price: 100 });
  });

  it("от одного магазина не больше четырёх: ленту не занимает один автор", async () => {
    svc.tables.products = Array.from({ length: 8 }, (_, i) => product("b1", `p${i}`, i + 1));
    svc.tables.marketplace_items = Array.from({ length: 8 }, (_, i) => snap("b1", `p${i}`));
    expect(await freshItems(shops, as(svc))).toHaveLength(4);
  });

  it("сбой чтения — ошибка, а не пустая лента", async () => {
    svc.tables.products = [product("b1", "p1", 1)];
    await expect(freshItems(shops, as(withBrokenReads(svc, ["products"])))).rejects.toThrow();
  });
});

describe("«Часто покупают»: счёт по настоящим заказам", () => {
  const BOT = "b1";
  const ctxFor = (db: FakeDb) =>
    ({
      tenant: { id: BOT, name: "Лавка", vertical: "shop", modules: {}, settings: {} },
      db,
    }) as unknown as TenantContext;
  const order = (id: number, buyer: number, status: string, bot = BOT) => ({
    id,
    bot_id: bot,
    telegram_id: buyer,
    status,
    created_at: "2026-09-20T10:00:00Z",
  });
  let shop: FakeDb;
  beforeEach(() => {
    shop = fakeDb();
    shop.tables.app_settings = [];
    shop.tables.orders = [
      order(1, 10, "delivered"),
      order(2, 11, "delivered"),
      order(3, 12, "cancelled"),
      order(4, 13, "awaiting_payment"),
      order(5, 14, "rejected"),
      order(6, 10, "delivered"), // тот же покупатель второй раз
      order(7, 15, "delivered", "other"),
    ];
    shop.tables.order_items = [
      { id: 1, order_id: 1, product_id: "p1" },
      { id: 2, order_id: 2, product_id: "p1" },
      { id: 3, order_id: 3, product_id: "p1" },
      { id: 4, order_id: 4, product_id: "p1" },
      { id: 5, order_id: 5, product_id: "p1" },
      { id: 6, order_id: 6, product_id: "p2" },
      { id: 7, order_id: 7, product_id: "p1" },
    ];
  });

  it("считаются разные покупатели выданных заказов; отменённые, неоплаченные, отклонённые, чужой магазин и повтор одного покупателя — нет", async () => {
    const p = await computePopular(ctxFor(shop), NOW);
    expect(p.items).toEqual([{ id: "p1", n: 2 }]); // p2: один покупатель — мало
  });

  it("пишется в настройки магазина; сбой чтения — ошибка и прежняя запись цела", async () => {
    expect(await refreshPopular(ctxFor(shop), NOW)).toBe(true);
    const saved = shop.tables.app_settings!.find((r) => r.key === POPULAR_KEY);
    expect(parsePopular(String(saved?.value))?.items).toEqual([{ id: "p1", n: 2 }]);
    const broken = withBrokenReads(shop, ["orders"]);
    await expect(refreshPopular(ctxFor(broken), NOW)).rejects.toThrow();
    expect(
      parsePopular(String(shop.tables.app_settings!.find((r) => r.key === POPULAR_KEY)?.value)),
    ).not.toBeNull();
  });

  it("лента: по числу покупателей, только строки снимка показываемых магазинов", async () => {
    const put = (bot: string, items: Array<{ id: string; n: number }>) =>
      svc.tables.app_settings!.push({
        bot_id: bot,
        key: POPULAR_KEY,
        value: JSON.stringify({ v: 1, at: NOW.toISOString(), items }),
      });
    svc.tables.app_settings = [];
    put("b1", [
      { id: "p1", n: 5 },
      { id: "p2", n: 2 },
    ]);
    put("b2", [{ id: "p3", n: 3 }]);
    put("hidden", [{ id: "p9", n: 99 }]);
    svc.tables.marketplace_items = [snap("b1", "p1"), snap("b2", "p3"), snap("hidden", "p9")];
    const r = await popularItems(shops, as(svc));
    expect(r.map((i) => i.id)).toEqual(["p1", "p3"]); // p2 закончился, p9 скрытого магазина
  });
});

describe("чистые правила", () => {
  it("buildPopular: порог двух разных покупателей и порядок", () => {
    const p = buildPopular(
      [
        { productId: "a", buyer: 1 },
        { productId: "a", buyer: 1 },
        { productId: "b", buyer: 1 },
        { productId: "b", buyer: 2 },
        { productId: "b", buyer: 3 },
        { productId: "c", buyer: 1 },
        { productId: "c", buyer: 2 },
      ],
      NOW,
    );
    expect(p.items).toEqual([
      { id: "b", n: 3 },
      { id: "c", n: 2 },
    ]);
  });
  it("parsePopular и capPerShop", () => {
    expect(parsePopular("{oops")).toBeNull();
    expect(parsePopular('{"v":1,"items":[{"id":"x","n":0},{"id":"y","n":2}]}')?.items).toEqual([
      { id: "y", n: 2 },
    ]);
    const list = Array.from({ length: 6 }, (_, i) => ({ shopId: "s", i }));
    expect(capPerShop(list)).toHaveLength(4);
  });
});
