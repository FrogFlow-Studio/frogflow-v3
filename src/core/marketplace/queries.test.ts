import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { Db } from "@/core/db/client.server";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { buildAccount, ACCOUNT_SHOPS_MAX } from "./account.server";
import { buyerShops } from "./buyers.server";
import { searchMarketItems } from "./items.server";
import { REPORT_EVENT, REPORT_STATUS } from "./report";
import { listOpenReports } from "./report.server";
import { listMarketShops, marketFacets } from "./shops.server";

/**
 * Страницы площадки читают базу одинаково много на 5 и на 50 строк: число запросов зависит
 * от размера страницы и числа порций, а не от числа магазинов, товаров и жалоб.
 */
const as = (d: FakeDb) => d as unknown as Db;
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function shopsDb(n: number) {
  const db = fakeDb();
  db.tables.marketplace_shops = range(n).map((i) => ({
    bot_id: id(i),
    slug: `shop-${i}`,
    name: `Магазин ${String(i).padStart(3, "0")}`,
    category: i % 2 ? "Сладости" : "Цветы",
    city: "Алматы",
    rating: null,
    rating_count: 0,
    orders_month: 0,
    since: null,
  }));
  return db;
}
const shown = (n: number) => async () => new Set(range(n).map(id));

describe("площадка: число запросов не растёт с числом строк", () => {
  it("каталог магазинов", async () => {
    const run = async (n: number) => {
      const db = shopsDb(n);
      const page = await listMarketShops({}, { svc: as(db), shown: shown(n) });
      expect(page.shops.length).toBeGreaterThan(0);
      return db.queries;
    };
    expect(await run(50)).toBe(await run(5));
  });

  it("фильтры каталога", async () => {
    const run = async (n: number) => {
      const db = shopsDb(n);
      const facets = await marketFacets({ svc: as(db), shown: shown(n) });
      expect(facets.cities).toEqual([{ value: "Алматы", count: n }]);
      return db.queries;
    };
    expect(await run(50)).toBe(await run(5));
  });

  it("поиск товаров", async () => {
    const run = async (n: number) => {
      const db = fakeDb();
      db.tables.marketplace_items = range(n).map((i) => ({
        bot_id: id(i),
        product_id: id(1000 + i),
        name: `Торт ${i}`,
        search_text: `торт ${i}`,
        price: 1000,
        currency: "KZT",
        image: null,
        updated_at: "2026-10-01T00:00:00Z",
      }));
      const shops = new Map(range(n).map((i) => [id(i), { slug: `s${i}`, name: `Магазин ${i}` }]));
      const found = await searchMarketItems(
        { search: "торт" },
        { svc: as(db), shown: async () => shops },
      );
      expect(found.items.length).toBeGreaterThan(0);
      return db.queries;
    };
    expect(await run(50)).toBe(await run(5));
  });

  it("жалобы оператора", async () => {
    const run = async (n: number) => {
      const db = fakeDb();
      db.tables.zernio_logs = range(n).map((i) => ({
        id: id(i),
        bot_id: id(1),
        event_type: REPORT_EVENT,
        status: REPORT_STATUS.open,
        created_at: `2026-10-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
        payload: { slug: "s", shop: "Магазин", reason: "other", text: `Жалоба ${i}` },
      }));
      const page = await listOpenReports(0, as(db));
      expect(page.total).toBe(n);
      return db.queries;
    };
    expect(await run(50)).toBe(await run(5));
  });

  it("магазины человека", async () => {
    const run = async (n: number) => {
      const db = fakeDb();
      db.tables.marketplace_buyer_links = range(n).map((i) => ({
        buyer_id: id(1),
        bot_id: id(i),
        user_key: `tg_${i}`,
      }));
      expect(await buyerShops(id(1), as(db))).toHaveLength(n);
      return db.queries;
    };
    expect(await run(50)).toBe(await run(5));
  });

  it("«Мои заказы»: магазинов не больше потолка, запросов тоже", async () => {
    const run = async (n: number) => {
      const tenants = new Map<string, Tenant>();
      const dbs = new Map<string, FakeDb>();
      for (const i of range(n)) {
        const t = {
          id: id(i),
          name: `Лавка ${i}`,
          archived: false,
          modules: {},
          settings: { served_by: "v2", slug: `s${i}` },
        } as unknown as Tenant;
        tenants.set(t.id, t);
        const db = fakeDb();
        db.tables.categories = [];
        db.tables.products = [];
        db.tables.orders = [];
        db.tables.bot_users = [
          {
            bot_id: t.id,
            user_key: "tg_1",
            telegram_id: 1,
            platform: "telegram",
            loyalty_points: 0,
            state: {},
          },
        ];
        dbs.set(t.id, db);
      }
      const links = range(n).map((i) => ({ botId: id(i), userKey: "tg_1" }));
      const account = await buildAccount(links, tenants, {
        ctxFor: (t) => ({ tenant: t, db: as(dbs.get(t.id)!) }) as unknown as TenantContext,
        statusLabel: (s) => s,
      });
      expect(account.shops).toHaveLength(Math.min(n, ACCOUNT_SHOPS_MAX));
      return [...dbs.values()].reduce((sum, d) => sum + d.queries, 0);
    };
    expect(await run(ACCOUNT_SHOPS_MAX + 30)).toBe(await run(ACCOUNT_SHOPS_MAX));
  });
});
