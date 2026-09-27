import { describe, expect, it } from "vitest";
import {
  assortmentMap,
  MAX_CARDS,
  queryTokens,
  searchCatalog,
  sizeMatches,
  sizesIn,
  type CatalogItem,
} from "./catalog-search";

let n = 0;
const item = (p: Partial<CatalogItem> & { name: string }): CatalogItem => ({
  id: `p${++n}`,
  category: null,
  description: "",
  keywords: "",
  price: 10_000,
  currency: "KZT",
  stock: null,
  variants: [],
  ...p,
});

describe("размеры", () => {
  it("140x70 и 70x140 — один размер, «70 на 140» тоже", () => {
    expect(sizeMatches("Полотенце 70x140", "140x70")).toBe(true);
    expect(sizeMatches("Полотенце 70х140", "70 на 140")).toBe(true);
    expect(sizeMatches("Полотенце 50x90", "140x70")).toBe(false);
  });

  it("допуск 3 см и три стороны — по двум большим", () => {
    expect(sizeMatches("Матрас 160x200x22", "160x200")).toBe(true);
    expect(sizeMatches("Одеяло 155x200", "160x200")).toBe(false);
    expect(sizeMatches("Одеяло 158x200", "160x200")).toBe(true);
    expect(sizesIn("200x160x22")).toEqual([[200, 160]]);
  });
});

describe("поиск по каталогу", () => {
  const towels = [
    item({ name: "Полотенце Aquanova 70x140", category: "Полотенца", price: 12_000 }),
    item({ name: "Полотенце Aquanova 50x90", category: "Полотенца", price: 7_000 }),
    item({ name: "Одеяло Traumina пуховое 200x220", category: "Одеяла", price: 190_000 }),
    item({ name: "Подушка Traumina 50x70", category: "Подушки", price: 30_000 }),
  ];

  it("слова в другой форме находят товар, размер без порядка сторон", () => {
    const r = searchCatalog(towels, { query: "полотенца 140x70" });
    expect(r.items.map((i) => i.name)).toEqual(["Полотенце Aquanova 70x140"]);
    expect(r.total_matches).toBe(1);
  });

  it("служебные слова и лишнее слово не обнуляют поиск", () => {
    const r = searchCatalog(towels, { query: "хочу одеяло белое" });
    expect(r.items.map((i) => i.name)).toEqual(["Одеяло Traumina пуховое 200x220"]);
  });

  it("ничего не подошло — пустой список, без чужой категории", () => {
    const r = searchCatalog(towels, { query: "плед" });
    expect(r).toMatchObject({ total_matches: 0, items: [] });
  });

  it("бюджет не выводит из категории; мимо бюджета — самое дешёвое той же выборки", () => {
    const r = searchCatalog(towels, { query: "одеяло", max_price: 100_000 });
    expect(r.items).toEqual([]);
    expect(r.cheapest_ignoring_price_limit?.name).toBe("Одеяло Traumina пуховое 200x220");
    const ok = searchCatalog(towels, { query: "полотенце", max_price: 8_000 });
    expect(ok.items.map((i) => i.price)).toEqual([7_000]);
  });

  it("цена варианта учитывается в бюджете", () => {
    const withVariants = [
      item({
        name: "Простыня",
        price: 50_000,
        variants: [
          { name: "160x200", price: 20_000 },
          { name: "200x220", price: 50_000 },
        ],
      }),
    ];
    expect(
      searchCatalog(withVariants, { query: "простыня", max_price: 25_000 }).items,
    ).toHaveLength(1);
    expect(searchCatalog(withVariants, { query: "простыня", size: "220x200" }).items).toHaveLength(
      1,
    );
    expect(searchCatalog(withVariants, { query: "простыня", size: "90x200" }).items).toHaveLength(
      0,
    );
  });

  it("широкий запрос — сводка без карточек; «покажите все» — карточки", () => {
    const many = Array.from({ length: MAX_CARDS + 4 }, (_, i) =>
      item({ name: `Полотенце Aquanova ${50 + i}x90`, category: "Полотенца", price: 5_000 + i }),
    );
    const broad = searchCatalog(many, { query: "Aquanova" });
    expect(broad.items).toEqual([]);
    expect(broad.total_matches).toBe(many.length);
    expect(broad.summary).toMatchObject({
      categories: ["Полотенца"],
      price_from: 5_000,
      price_to: 5_000 + MAX_CARDS + 3,
    });
    expect(broad.summary!.sizes.length).toBeGreaterThan(0);
    expect(searchCatalog(many, { query: "Aquanova", show_all: true }).items).toHaveLength(
      many.length,
    );
  });

  it("в наличии — первыми, отсутствующие остаются в выдаче после них", () => {
    const r = searchCatalog(
      [
        item({ name: "Плед серый", stock: 0, price: 1 }),
        item({ name: "Плед синий", stock: 3, price: 2 }),
      ],
      { query: "плед" },
    );
    expect(r.items.map((i) => i.name)).toEqual(["Плед синий", "Плед серый"]);
  });

  it("категория сужает выбор", () => {
    const r = searchCatalog(towels, { query: "Traumina", category: "подушки" });
    expect(r.items.map((i) => i.name)).toEqual(["Подушка Traumina 50x70"]);
  });

  it("слова запроса: без размеров, чисел и служебных слов", () => {
    expect(queryTokens("Покажите полотенце 70 на 140, есть?")).toEqual(["полотенце"]);
  });
});

describe("карта ассортимента", () => {
  it("строка на категорию: позиций в наличии и цена «от»", () => {
    const map = assortmentMap([
      item({ name: "A", category: "Полотенца", price: 7_000 }),
      item({ name: "B", category: "Полотенца", price: 5_000 }),
      item({ name: "C", category: "Полотенца", price: 1_000, stock: 0 }),
      item({ name: "D", price: 3_000 }),
    ]);
    expect(map).toBe("- Полотенца: 2 поз., от 5000 KZT\n- Без категории: 1 поз., от 3000 KZT");
  });
});
