import { describe, expect, it } from "vitest";
import { findPartialProducts, findProducts, type ConsultantProduct } from "./catalog";
import { executeConsultantTool } from "./tools";

/** Срез прайса BOVI 21.09: полотенце для волос и соседи по разделу. */
function product(p: Partial<ConsultantProduct> & { id: string; name: string }): ConsultantProduct {
  return { category: "Полотенца", size: "", colors: [], price_kzt: 15_000, stock: true, ...p };
}
const CATALOG: ConsultantProduct[] = [
  product({
    id: "hair",
    name: "Uchino Полотенце для волос Beauty Hair Strech Towel",
    size: "38x80",
    colors: ["серый"],
    price_kzt: 25_000,
  }),
  product({ id: "bath", name: "Uchino Полотенце банное", size: "70x140", price_kzt: 30_000 }),
  product({ id: "pip", name: "PIP Studio Полотенце Secret Garden", size: "30x50" }),
  product({ id: "rug", name: "Aquanova Коврик Maks", category: "Коврики", size: "60x60" }),
];

describe("поиск по части слов (BOVI 09.10, lenakzm)", () => {
  it("«полотенце чалма для волос»: по всем словам пусто, по части — полотенце для волос", () => {
    expect(findProducts({ query: "полотенце чалма для волос" }, CATALOG).all).toEqual([]);
    const partial = findPartialProducts({ query: "полотенце чалма для волос" }, CATALOG);
    expect(partial?.shown.map((p) => p.id)).toEqual(["hair"]);
    expect(partial?.missingWords).toEqual(["чалма"]);
    expect(partial?.wordsNotInCatalog).toEqual(["чалма"]);
  });

  it("«полотенце для головы»: совпало только «полотенце» — все полотенца, «головы» в каталоге нет", () => {
    const partial = findPartialProducts({ query: "полотенце для головы" }, CATALOG);
    expect(partial?.shown.map((p) => p.id).sort()).toEqual(["bath", "hair", "pip"]);
    expect(partial?.matchedWords).toEqual(["полотенце"]);
    expect(partial?.wordsNotInCatalog).toEqual(["головы"]);
  });

  it("одно слово или ни одного совпадения — частичной выдачи нет", () => {
    expect(findPartialProducts({ query: "чалма" }, CATALOG)).toBeNull();
    expect(findPartialProducts({ query: "тюрбан чалма" }, CATALOG)).toBeNull();
  });

  it("фильтры запроса держатся: размер 60x60 не отдаёт полотенца", () => {
    expect(
      findPartialProducts({ query: "полотенце для головы", size: "60x60" }, CATALOG),
    ).toBeNull();
  });

  it("инструмент поиска: пусто по всем словам — карточки частичного совпадения и что не совпало", async () => {
    const r = await executeConsultantTool(
      "search_products",
      { query: "полотенце чалма для волос" },
      { catalog: CATALOG },
    );
    const result = r.result as {
      products: Array<{ name: string; price_kzt: number }>;
      total_matches: number;
      partial_match: { missing_words: string[]; words_not_in_catalog: string[] };
      note: string;
    };
    expect(result.total_matches).toBe(0);
    expect(result.products.map((p) => p.price_kzt)).toEqual([25_000]);
    expect(result.partial_match.words_not_in_catalog).toEqual(["чалма"]);
    expect(result.note).toContain("not a «no»");
    // Карточки — в проверку ответа: цена 25 000 названа из выдачи.
    expect(r.products.map((p) => p.id)).toEqual(["hair"]);
  });

  it("инструмент поиска: нашлось по всем словам — без частичной выдачи", async () => {
    const r = await executeConsultantTool(
      "search_products",
      { query: "полотенце для волос", size: "38x80" },
      { catalog: CATALOG },
    );
    expect(r.result).not.toHaveProperty("partial_match");
    expect(r.products.map((p) => p.id)).toEqual(["hair"]);
  });
});
