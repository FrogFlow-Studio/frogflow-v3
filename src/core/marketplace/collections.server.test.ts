import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { Db } from "@/core/db/client.server";
import {
  deleteCollection,
  operatorCollectionsView,
  publicCollections,
  saveCollection,
} from "./collections.server";
import { MarketplaceNotReady } from "./not-ready";
import { cleanItems, cleanTitles, titleFor } from "./collections";
import { COLLECTION_ITEMS_MAX } from "./collections";

/** Подборки площадки (Л3): оператор создаёт, покупатель читает, продавец не пишет. */
let svc: FakeDb;
const as = (d: FakeDb) => d as unknown as Db;
const BOT = "11111111-1111-4111-8111-111111111111";
const B2 = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const pid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const shops = new Map([
  [BOT, { slug: "cakes", name: "Лавка" }],
  [B2, { slug: "flowers", name: "Сад" }],
]);
const snap = (bot: string, n: number) => ({
  bot_id: bot,
  product_id: pid(n),
  name: `Товар ${n}`,
  search_text: "",
  price: 100 * n,
  currency: "KZT",
  image: null,
  updated_at: "2026-10-05T10:00:00Z",
});
const row = (id: string, items: Array<[string, number]>, extra: Record<string, unknown> = {}) => ({
  id,
  title: { ru: "Для школы", en: "For school" },
  items: items.map(([b, n]) => ({ shop_id: b, product_id: pid(n) })),
  position: 0,
  published: true,
  rev: 1,
  ...extra,
});
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";

beforeEach(() => {
  svc = fakeDb();
  svc.tables.market_collections = [];
  svc.tables.marketplace_items = [snap(BOT, 1), snap(BOT, 2), snap(B2, 3), snap(HIDDEN, 4)];
});

describe("подборки на главной площадки", () => {
  it("показываются опубликованные, на языке покупателя, в порядке; черновик — нет", async () => {
    svc.tables.market_collections = [
      row(
        C1,
        [
          [BOT, 1],
          [B2, 3],
        ],
        { position: 2 },
      ),
      row(C2, [[BOT, 2]], { position: 1, title: { ru: "Подарки" } }),
      row("c3333333-3333-4333-8333-333333333333", [[BOT, 1]], { published: false }),
    ];
    const en = await publicCollections(shops, "en", as(svc));
    expect(en.map((c) => [c.title, c.items.map((i) => i.name)])).toEqual([
      ["Подарки", ["Товар 2"]], // нет английского названия — русское
      ["For school", ["Товар 1", "Товар 3"]],
    ]);
    expect((await publicCollections(shops, "ru", as(svc)))[1]!.title).toBe("Для школы");
  });

  it("удалённый, закончившийся и скрытого магазина товар пропадает; пустая подборка не показывается", async () => {
    svc.tables.market_collections = [
      row(C1, [
        [BOT, 1],
        [BOT, 99],
        [HIDDEN, 4],
      ]),
      row(C2, [
        [BOT, 98],
        [HIDDEN, 4],
      ]),
    ];
    const r = await publicCollections(shops, "ru", as(svc));
    expect(r).toHaveLength(1);
    expect(r[0]!.items.map((i) => i.name)).toEqual(["Товар 1"]);
  });

  it("таблицы нет — MarketplaceNotReady (страница без подборок); сбой чтения — ошибка", async () => {
    const missing = {
      from: () => {
        const result = {
          data: null,
          error: { code: "PGRST205", message: "Could not find the table" },
        };
        const p: unknown = new Proxy(
          {},
          {
            get: (_t, k) =>
              k === "then"
                ? (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
                : () => p,
          },
        );
        return p;
      },
    } as unknown as Db;
    await expect(publicCollections(shops, "ru", missing)).rejects.toBeInstanceOf(
      MarketplaceNotReady,
    );
    svc.tables.market_collections = [row(C1, [[BOT, 1]])];
    await expect(
      publicCollections(shops, "ru", as(withBrokenReads(svc, ["market_collections"]))),
    ).rejects.toThrow();
  });
});

describe("оператор создаёт и правит", () => {
  const input = (extra: Record<string, unknown> = {}) => ({
    title: { ru: "Подарки", kk: "" },
    items: [{ shopId: BOT, productId: pid(1) }],
    published: true,
    position: 3,
    ...extra,
  });

  it("создание: русское название обязательно, не больше 24 товаров, повтор товара не дублируется", async () => {
    await expect(saveCollection(input({ title: { en: "x" } }), as(svc))).rejects.toThrow(
      /по-русски/,
    );
    const many = Array.from({ length: COLLECTION_ITEMS_MAX + 1 }, (_, i) => ({
      shopId: BOT,
      productId: pid(i + 1),
    }));
    await expect(saveCollection(input({ items: many }), as(svc))).rejects.toThrow(/не больше/);
    const made = await saveCollection(
      input({ items: [...input().items, ...input().items] }),
      as(svc),
    );
    const view = await operatorCollectionsView(as(svc));
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ id: made.id, rev: 1, published: true, names: ["Товар 1"] });
    expect(view[0]!.items).toHaveLength(1);
  });

  it("правка по номеру: старая вкладка не затирает новую", async () => {
    const made = await saveCollection(input(), as(svc));
    const a = await saveCollection(input({ id: made.id, rev: 1, position: 7 }), as(svc));
    expect(a.rev).toBe(2);
    await expect(
      saveCollection(input({ id: made.id, rev: 1, position: 9 }), as(svc)),
    ).rejects.toThrow(/другом окне/);
    expect((await operatorCollectionsView(as(svc)))[0]).toMatchObject({ position: 7, rev: 2 });
  });

  it("товар, которого на площадке нет, оператор видит с пометкой (имя null)", async () => {
    svc.tables.market_collections = [
      row(C1, [
        [BOT, 1],
        [BOT, 99],
      ]),
    ];
    expect((await operatorCollectionsView(as(svc)))[0]!.names).toEqual(["Товар 1", null]);
  });

  it("удаление убирает подборку", async () => {
    svc.tables.market_collections = [row(C1, [[BOT, 1]])];
    await deleteCollection(C1, as(svc));
    expect(await operatorCollectionsView(as(svc))).toEqual([]);
  });
});

describe("чистые правила и права", () => {
  it("названия: ru обязателен, лишние пробелы убираются, пустое — русское", () => {
    expect(cleanTitles({ ru: "  Для   школы ", kk: "" })).toEqual({ ru: "Для школы" });
    expect(cleanTitles({ en: "x" })).toBeNull();
    expect(titleFor({ ru: "А", uz: "Б" }, "uz")).toBe("Б");
    expect(titleFor({ ru: "А" }, "kk")).toBe("А");
  });
  it("состав: не uuid делает список недопустимым", () => {
    expect(cleanItems([{ shopId: "x", productId: pid(1) }])).toBeNull();
    expect(cleanItems("oops")).toBeNull();
  });
  it("продавец подборки не пишет: админка о подборках не знает", () => {
    const dir = "src/app/admin";
    for (const f of readdirSync(dir).filter((x) => /\.(ts|tsx)$/.test(x))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/market_collections|marketplace\/collections/);
    }
  });
});
