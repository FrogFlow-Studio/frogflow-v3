import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import { syncServerFavorites } from "@/core/storefront/favorites-sync";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { buildAccount, FAVORITES_PER_SHOP } from "./account.server";

/** «Мои заказы» площадки: только профили из связей человека, избранное и адреса — из его заказов. */
let shopA: FakeDb;
let shopB: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = (id: string, served = "v2", archived = false) =>
  ({
    id,
    name: `Лавка ${id}`,
    archived,
    modules: {},
    settings: { served_by: served, slug: id.toLowerCase() },
  }) as unknown as Tenant;
const TENANTS = new Map<string, Tenant>();
const dbs = new Map<string, FakeDb>();
const ctxFor = (t: Tenant) => ({ tenant: t, db: as(dbs.get(t.id)!) }) as unknown as TenantContext;
const deps = { ctxFor, statusLabel: (s: string) => `статус:${s}` };

const prod = (n: number, bot: string, extra: Record<string, unknown> = {}) => ({
  id: pid(n),
  bot_id: bot,
  name: `Торт ${n}`,
  description: "",
  price: 1000 * n,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  sort_order: n,
  fulfillment_kind: "physical",
  stock_quantity: null,
  category_ids: [],
  rating_count: 0,
  rating_avg: null,
  created_at: new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString(),
  product_images: [],
  product_variants: [],
  product_material_files: [],
  ...extra,
});
const user = (bot: string, tg: number, ids: string[]) => ({
  bot_id: bot,
  user_key: `tg_${tg}`,
  telegram_id: tg,
  platform: "telegram",
  loyalty_points: 777,
  state: { web_fav: { ids, rev: 1 } },
});
const order = (bot: string, no: number, tg: number, at: string, address: string | null) => ({
  id: no,
  bot_id: bot,
  order_no: no,
  display_no: no,
  telegram_id: tg,
  status: "paid",
  total: 1500,
  currency: "KZT",
  fulfillment_address: address,
  created_at: at,
  order_items: [],
});

beforeEach(() => {
  TENANTS.clear();
  dbs.clear();
  shopA = fakeDb();
  shopB = fakeDb();
  for (const [id, d] of [
    ["A", shopA],
    ["B", shopB],
  ] as const) {
    TENANTS.set(id, tenant(id));
    dbs.set(id, d);
    d.tables.categories = [];
  }
  shopA.tables.products = [prod(1, "A"), prod(2, "A"), prod(3, "A", { is_active: false })];
  shopB.tables.products = [prod(4, "B")];
  shopA.tables.bot_users = [
    user("A", 1001, [pid(1), pid(2), pid(3), pid(99)]),
    user("A", 2002, [pid(2)]),
  ];
  shopB.tables.bot_users = [user("B", 1001, [pid(4)])];
  shopA.tables.orders = [
    order("A", 1, 1001, "2026-10-01T10:00:00Z", "Алматы, Абая 1"),
    order("A", 2, 1001, "2026-10-03T10:00:00Z", "Астана, Мира 5"),
    order("A", 3, 2002, "2026-10-02T10:00:00Z", "Чужой адрес, 9"),
  ];
  shopB.tables.orders = [order("B", 7, 1001, "2026-10-04T10:00:00Z", " алматы,  абая 1 ")];
});

describe("страница «Мои заказы»", () => {
  it("по связям человека: свои заказы, избранное без пропавших товаров и адреса без повторов", async () => {
    const a = await buildAccount(
      [
        { botId: "A", userKey: "tg_1001" },
        { botId: "B", userKey: "tg_1001" },
      ],
      TENANTS,
      deps,
    );
    expect(a.shops.map((s) => s.slug)).toEqual(["a", "b"]);
    expect(a.shops[0]!.orders.map((o) => o.no).sort()).toEqual([1, 2]);
    expect(a.shops[0]!.orders[0]!.status).toBe("статус:paid");
    // снятый с продажи и несуществующий товар в избранном не показываются
    expect(a.shops[0]!.favorites.map((f) => f.id).sort()).toEqual([pid(1), pid(2)]);
    expect(a.shops[1]!.favorites.map((f) => f.id)).toEqual([pid(4)]);
    // новые адреса первыми, «Алматы, Абая 1» один раз (из двух магазинов)
    expect(a.addresses).toEqual(["алматы, абая 1", "Астана, Мира 5"]);
    expect(a.moreAddresses).toBe(0);
  });

  it("чужой профиль того же магазина не открывается: ни заказов, ни избранного, ни адреса", async () => {
    const a = await buildAccount([{ botId: "A", userKey: "tg_1001" }], TENANTS, deps);
    const text = JSON.stringify(a);
    expect(text).not.toContain("Чужой адрес");
    expect(a.shops[0]!.orders.map((o) => o.no)).not.toContain(3);
    expect(text).not.toContain("777"); // баллы не отдаются
    const boris = await buildAccount([{ botId: "A", userKey: "tg_2002" }], TENANTS, deps);
    expect(boris.shops[0]!.orders.map((o) => o.no)).toEqual([3]);
    expect(boris.addresses).toEqual(["Чужой адрес, 9"]);
  });

  it("магазин прежней платформы и архивный в страницу не попадают", async () => {
    TENANTS.set("A", tenant("A", "v1"));
    TENANTS.set("B", tenant("B", "v2", true));
    const a = await buildAccount(
      [
        { botId: "A", userKey: "tg_1001" },
        { botId: "B", userKey: "tg_1001" },
        { botId: "Z", userKey: "tg_1001" },
      ],
      TENANTS,
      deps,
    );
    expect(a.shops).toEqual([]);
    expect(a.addresses).toEqual([]);
  });

  it("избранного больше предела — показано сколько влезло и число остального", async () => {
    const many = Array.from({ length: FAVORITES_PER_SHOP + 3 }, (_, i) => i + 10);
    shopA.tables.products = many.map((n) => prod(n, "A"));
    shopA.tables.bot_users = [user("A", 1001, many.map(pid))];
    const a = await buildAccount([{ botId: "A", userKey: "tg_1001" }], TENANTS, deps);
    expect(a.shops[0]!.favorites).toHaveLength(FAVORITES_PER_SHOP);
    expect(a.shops[0]!.moreFavorites).toBe(3);
  });

  it("сбой чтения заказов — ошибка, а не пустая страница", async () => {
    dbs.set("A", withBrokenReads(shopA, ["orders"]) as unknown as FakeDb);
    await expect(
      buildAccount([{ botId: "A", userKey: "tg_1001" }], TENANTS, deps),
    ).rejects.toThrow();
  });
});

describe("избранное при двух входах одного покупателя", () => {
  it("с телефона и с компьютера: после обоих входов в магазине обе отметки, ничего не потеряно", async () => {
    const ctx = ctxFor(TENANTS.get("A")!);
    await syncServerFavorites(ctx, 2002, [pid(1)], "merge"); // телефон
    const second = await syncServerFavorites(ctx, 2002, [pid(2)], "merge"); // компьютер
    expect(second!.sort()).toEqual([pid(1), pid(2)].sort());
    const a = await buildAccount([{ botId: "A", userKey: "tg_2002" }], TENANTS, deps);
    expect(a.shops[0]!.favorites.map((f) => f.id).sort()).toEqual([pid(1), pid(2)].sort());
    // чужое состояние профиля (rev секции избранного) повышается, остальное не затёрто
    const row = shopA.tables.bot_users!.find((u) => u.user_key === "tg_2002")!;
    expect(row.loyalty_points).toBe(777);
  });
});
