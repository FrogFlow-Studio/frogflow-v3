import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import type { Tenant } from "@/core/tenant/types";
import { FAVORITES_MAX, favoriteKey } from "./favorites";
import { addFavorite, favoriteKeys, listFavorites, removeFavorite } from "./favorites.server";
import { MarketplaceNotReady } from "./not-ready";

/** Избранное на площадке: только своё, только то, что в снимке и у показываемого магазина. */
let svc: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ANNA = id(1);
const BORIS = id(2);
const SHOP = id(100);
const HIDDEN = id(101);
const V1 = id(102);
const tenant = (botId: string, slug: string, settings: Tenant["settings"]) =>
  ({
    id: botId,
    name: `Магазин ${slug}`,
    vertical: "confectionery",
    settings,
  }) as unknown as Tenant;
const tenants = [
  tenant(SHOP, "cakes", {
    served_by: "v2",
    slug: "cakes",
    marketplace: { listed: true, approved: true },
  }),
  tenant(HIDDEN, "off", {
    served_by: "v2",
    slug: "off",
    marketplace: { listed: true, hidden: true },
  }),
  tenant(V1, "old", { slug: "old", marketplace: { listed: true, approved: true } }),
];
const item = (botId: string, n: number) => ({
  bot_id: botId,
  product_id: id(1000 + n),
  name: `Торт ${n}`,
  search_text: `торт ${n}`,
  price: 1000 + n,
  currency: "KZT",
  image: null,
  updated_at: "2026-10-05T00:00:00Z",
});
const deps = () => ({ svc: as(svc), tenants });

beforeEach(() => {
  svc = fakeDb({ unique: { buyer_favorites: [["buyer_id", "bot_id", "product_id"]] } });
  svc.tables.marketplace_items = [item(SHOP, 1), item(SHOP, 2), item(HIDDEN, 3), item(V1, 4)];
  svc.tables.buyer_favorites = [];
});

describe("отметить товар", () => {
  it("товар из снимка показываемого магазина отмечается, повтор и два клика разом — одна строка", async () => {
    const r = await Promise.all([
      addFavorite(ANNA, SHOP, id(1001), deps()),
      addFavorite(ANNA, SHOP, id(1001), deps()),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(["added", "already"]);
    expect(svc.tables.buyer_favorites).toHaveLength(1);
  });

  it("скрытый оператором магазин, магазин прежней платформы и товара нет в снимке — «unknown»", async () => {
    expect((await addFavorite(ANNA, HIDDEN, id(1003), deps())).status).toBe("unknown");
    expect((await addFavorite(ANNA, V1, id(1004), deps())).status).toBe("unknown");
    expect((await addFavorite(ANNA, SHOP, id(1999), deps())).status).toBe("unknown");
    expect((await addFavorite("не-uuid", SHOP, id(1001), deps())).status).toBe("unknown");
    expect(svc.tables.buyer_favorites).toHaveLength(0);
  });

  it("после предела новое не принимается, уже отмеченное остаётся «already»", async () => {
    svc.tables.buyer_favorites = Array.from({ length: FAVORITES_MAX }, (_, i) => ({
      buyer_id: ANNA,
      bot_id: SHOP,
      product_id: id(5000 + i),
      created_at: "2026-10-01T00:00:00Z",
    }));
    svc.tables.buyer_favorites.push();
    expect((await addFavorite(ANNA, SHOP, id(1001), deps())).status).toBe("full");
    svc.tables.buyer_favorites[0] = { ...svc.tables.buyer_favorites[0]!, product_id: id(1001) };
    expect((await addFavorite(ANNA, SHOP, id(1001), deps())).status).toBe("already");
    // у другого человека предел свой
    expect((await addFavorite(BORIS, SHOP, id(1001), deps())).status).toBe("added");
  });

  it("таблицы нет — MarketplaceNotReady, не ошибка", async () => {
    const broken = fakeDb();
    broken.tables.marketplace_items = [item(SHOP, 1)];
    const orig = broken.from.bind(broken);
    broken.from = ((t: string) =>
      t === "buyer_favorites"
        ? {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: null,
                  error: { code: "PGRST205", message: "Could not find the table" },
                }),
            }),
          }
        : orig(t)) as typeof broken.from;
    await expect(
      addFavorite(ANNA, SHOP, id(1001), { svc: as(broken), tenants }),
    ).rejects.toBeInstanceOf(MarketplaceNotReady);
  });
});

describe("убрать и прочитать", () => {
  it("убирается только своё: чужая строка остаётся", async () => {
    await addFavorite(ANNA, SHOP, id(1001), deps());
    await addFavorite(BORIS, SHOP, id(1001), deps());
    await removeFavorite(ANNA, SHOP, id(1001), as(svc));
    expect(svc.tables.buyer_favorites).toEqual([
      expect.objectContaining({ buyer_id: BORIS, product_id: id(1001) }),
    ]);
  });

  it("чужое избранное не видно ни в списке, ни в сердечках", async () => {
    await addFavorite(BORIS, SHOP, id(1002), deps());
    expect(await favoriteKeys(ANNA, as(svc))).toEqual([]);
    expect(await listFavorites(ANNA, deps())).toEqual({ items: [], gone: 0 });
    expect(await favoriteKeys(BORIS, as(svc))).toEqual([favoriteKey(SHOP, id(1002))]);
  });

  it("список: новые первыми, цена и название из снимка; ушедшее считается, а не теряется", async () => {
    svc.tables.buyer_favorites = [
      { buyer_id: ANNA, bot_id: SHOP, product_id: id(1001), created_at: "2026-10-01T00:00:00Z" },
      { buyer_id: ANNA, bot_id: SHOP, product_id: id(1002), created_at: "2026-10-03T00:00:00Z" },
      { buyer_id: ANNA, bot_id: HIDDEN, product_id: id(1003), created_at: "2026-10-04T00:00:00Z" },
      { buyer_id: ANNA, bot_id: SHOP, product_id: id(1777), created_at: "2026-10-02T00:00:00Z" },
    ];
    const r = await listFavorites(ANNA, deps());
    expect(r.items.map((i) => [i.id, i.name, i.price, i.shopSlug])).toEqual([
      [id(1002), "Торт 2", 1002, "cakes"],
      [id(1001), "Торт 1", 1001, "cakes"],
    ]);
    expect(r.gone).toBe(2);
  });

  it("сбой чтения — ошибка, а не пустое избранное", async () => {
    await addFavorite(ANNA, SHOP, id(1001), deps());
    const broken = withBrokenReads(svc, ["buyer_favorites"]);
    await expect(listFavorites(ANNA, { svc: as(broken), tenants })).rejects.toThrow();
    await expect(favoriteKeys(ANNA, as(broken))).rejects.toThrow();
  });
});
