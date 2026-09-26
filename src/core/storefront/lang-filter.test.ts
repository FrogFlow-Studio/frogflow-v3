import { describe, expect, it } from "vitest";
import { filterByLanguage, languageChips } from "./lang-filter";

const p = (id: string, languages: string[]) => ({ id, languages });
const catalog = [p("a", ["ru"]), p("b", ["kk", "ru"]), p("c", ["kk"]), p("d", [])];

describe("фильтр каталога по языку материала (Mini App v1)", () => {
  it("чипы — языки, реально заведённые в каталоге, в порядке ru, kk, en, uz", () => {
    expect(languageChips(catalog)).toEqual(["ru", "kk"]);
    expect(languageChips([p("x", ["uz"]), p("y", ["en", "ru"])])).toEqual(["ru", "en", "uz"]);
  });

  it("один язык на весь каталог — выбирать не из чего, чипов нет", () => {
    expect(languageChips([p("a", ["ru"]), p("b", ["ru"])])).toEqual([]);
    expect(languageChips([])).toEqual([]);
  });

  it("выбранный язык оставляет товары с файлами на нём; чипы считаются по всему каталогу", () => {
    expect(filterByLanguage(catalog, "kk").map((x) => x.id)).toEqual(["b", "c"]);
    expect(filterByLanguage(catalog, "ru").map((x) => x.id)).toEqual(["a", "b"]);
    expect(filterByLanguage(catalog, null).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    // Чипы после выбора не пропадают: строятся по нефильтрованному списку.
    expect(languageChips(catalog)).toEqual(["ru", "kk"]);
  });
});
