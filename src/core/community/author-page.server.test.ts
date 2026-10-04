import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

const db = fakeDb();
let tenants: Array<Record<string, unknown>> = [];
let catalog: { items: Array<Record<string, unknown>>; hasMore: boolean } = {
  items: [],
  hasMore: false,
};
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  resolveTenant: async (l: { value: string }) =>
    tenants.find((t) => (t.settings as { slug?: string }).slug === l.value) ?? null,
  tenantContext: (t: unknown) => ({ tenant: t }),
}));
vi.mock("@/core/storefront/catalog", () => ({ storeCatalogPage: async () => catalog }));

const srv = await import("./author-page.server");

const author = (id: string, slug: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Магазин ${id}`,
  archived: false,
  modules: { shop: true, web_storefront: true },
  ownerTelegramId: 777,
  telegramTokenEnc: "enc:secret",
  settings: {
    served_by: "v2",
    slug,
    community: {
      enabled: true,
      name: `Автор ${id}`,
      niche: "Торты",
      city: "Алматы",
      about: "Печём",
      links: ["https://x.kz"],
    },
    ...extra,
  },
});

beforeEach(() => {
  db.tables.marketplace_shops = [];
  catalog = { items: [], hasMore: false };
  tenants = [author("a", "anya"), author("b", "borya")];
});

describe("страница автора", () => {
  it("несогласный, скрытый, заблокированный и клиент прежней платформы не видны", async () => {
    tenants = [
      author("off", "off", { community: { enabled: false, name: "x" } }),
      author("hid", "hid", { community_mod: { status: "hidden" } }),
      author("blk", "blk", { community_mod: { status: "blocked" } }),
      author("old", "old", { served_by: undefined }),
    ];
    for (const slug of ["off", "hid", "blk", "old", "нет-такого"])
      expect(await srv.authorPage(slug), slug).toBeNull();
  });

  it("отдаёт профиль без владельца, токена и настроек", async () => {
    const p = (await srv.authorPage("anya"))!;
    expect(p.card).toEqual({
      name: "Автор a",
      niche: "Торты",
      city: "Алматы",
      about: "Печём",
      links: ["https://x.kz"],
    });
    const dump = JSON.stringify(p);
    expect(dump).not.toContain("777");
    expect(dump).not.toContain("enc:secret");
  });

  it("«Что продаю»: первые товары витрины и «есть ещё»; без каталога — пусто", async () => {
    catalog = {
      items: [
        { id: "p1", name: "Медовик", price: 9000, priceFrom: false, currency: "KZT", images: [] },
      ],
      hasMore: true,
    };
    const p = (await srv.authorPage("anya"))!;
    expect(p.items).toEqual([
      { id: "p1", name: "Медовик", price: 9000, priceFrom: false, currency: "KZT" },
    ]);
    expect(p.hasMoreItems).toBe(true);
    expect(p.storefront).toBe(true);
  });

  it("магазин без открытой витрины: товаров и ссылки на витрину нет, профиль есть", async () => {
    tenants = [{ ...author("a", "anya"), modules: { shop: true } }];
    const p = (await srv.authorPage("anya"))!;
    expect(p.items).toEqual([]);
    expect(p.storefront).toBe(false);
    expect(p.card.name).toBe("Автор a");
  });

  it("оценка — из каталога площадки и только пока магазин на площадке", async () => {
    db.tables.marketplace_shops = [{ bot_id: "a", rating: 4.8, rating_count: 12 }];
    expect((await srv.authorPage("anya"))!.rating).toBeNull();
    tenants = [author("a", "anya", { marketplace: { listed: true, approved: true } })];
    expect((await srv.authorPage("anya"))!.rating).toEqual({ value: 4.8, count: 12 });
    // скрыт с площадки оператором — оценку не показываем
    tenants = [
      author("a", "anya", { marketplace: { listed: true, approved: true, hidden: true } }),
    ];
    expect((await srv.authorPage("anya"))!.rating).toBeNull();
  });

  it("взаимная рекомендация видна и исчезает, когда один отозвал", async () => {
    tenants = [
      author("a", "anya", { community_recommend: ["b"] }),
      author("b", "borya", { community_recommend: ["a"] }),
    ];
    expect((await srv.authorPage("anya"))!.recommended).toEqual([
      { name: "Автор b", slug: "borya" },
    ]);
    expect(await srv.recommendedShops("borya")).toEqual([{ name: "Автор a", slug: "anya" }]);
    tenants = [author("a", "anya", { community_recommend: ["b"] }), author("b", "borya")];
    expect((await srv.authorPage("anya"))!.recommended).toEqual([]);
    expect(await srv.recommendedShops("anya")).toEqual([]);
  });
});
