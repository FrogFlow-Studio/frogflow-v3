import { describe, expect, it } from "vitest";
import type { ConsultantProduct } from "./catalog";
import { findProducts, isDiscontinuedProduct, isMattress, sellableProducts } from "./catalog";
import {
  cleanCatalogExcuses,
  cleanDiscontinuedMattressOffers,
  DISCONTINUED_MEDIUM_MATTRESS_REPLY,
  finalizePricelistText,
  isCatalogExcuse,
  offersDiscontinuedMattress,
  stripRepeatGreeting,
} from "./finalize";
import { executeConsultantTool } from "./tools";
import {
  DEFAULT_KNOWLEDGE_ARTICLES,
  formatKnowledgeForPrompt,
  parseKnowledgeArticlesFromText,
} from "./knowledge";

/**
 * Чистка ответа консультанта по прайсу и снятые с производства позиции
 * (перенос tests/consultant-discontinued, consultant-broad-answer и
 * bovi-features v1). Продавец: «матрасов средней жёсткости мы не упоминаем —
 * сняты с производства».
 */
function product(p: Partial<ConsultantProduct> & { id: string; name: string }): ConsultantProduct {
  return { category: "", size: "", colors: [], price_kzt: 100_000, stock: true, ...p };
}

const CATALOG: ConsultantProduct[] = [
  product({ id: "SOFT", name: "Dorelan LEVANT R4 SOFT", category: "Матрасы", size: "160x200" }),
  product({ id: "MED", name: "Dorelan TRESOR R2 MEDIUM", category: "Матрасы", size: "160x200" }),
  product({
    id: "MED_RU",
    name: "Матрас Frankenstolz средней жёсткости",
    category: "Матрасы",
    size: "180x200",
  }),
  product({ id: "FIRM", name: "Dorelan LEVANT R3 FIRM", category: "Матрасы", size: "180x200" }),
  product({
    id: "PROT",
    name: "Наматрасник Traumina MEDIUM",
    category: "Наматрасники",
    size: "160x200",
  }),
  product({ id: "PILLOW", name: "Подушка Traumina Medium", category: "Подушки", size: "50x70" }),
];

describe("снятое с производства — матрасы средней жёсткости", () => {
  it("MEDIUM-матрас помечен снятым, соседние товары — нет", () => {
    expect(isDiscontinuedProduct(CATALOG[1]!)).toBe(true);
    expect(isDiscontinuedProduct(CATALOG[2]!)).toBe(true);
    expect(isDiscontinuedProduct(CATALOG[0]!)).toBe(false);
    expect(isDiscontinuedProduct(CATALOG[3]!)).toBe(false);
  });

  it("наматрасник и подушка со словом MEDIUM остаются в продаже", () => {
    expect(isMattress(CATALOG[4]!)).toBe(false);
    expect(isMattress(CATALOG[5]!)).toBe(false);
    expect(isDiscontinuedProduct(CATALOG[4]!)).toBe(false);
    expect(isDiscontinuedProduct(CATALOG[5]!)).toBe(false);
  });

  it("sellableProducts убирает только снятые позиции", () => {
    expect(sellableProducts(CATALOG).map((p) => p.id)).toEqual(["SOFT", "FIRM", "PROT", "PILLOW"]);
  });

  it("поиск матраса средней жёсткости не находит ничего", () => {
    expect(findProducts({ category: "матрасы", hardness: "medium" }, CATALOG).all).toEqual([]);
  });

  it("запрос про среднюю жёсткость без категории не выдаёт ни одного матраса", () => {
    const { all } = findProducts({ hardness: "medium" }, CATALOG);
    expect(all.some((p) => p.category === "Матрасы")).toBe(false);
    expect(all.map((p) => p.id)).toEqual(["PROT", "PILLOW"]);
  });

  it("свободный просмотр матрасов не показывает снятые", () => {
    const { all, shown } = findProducts({ query: "матрас" }, CATALOG);
    expect(all.map((p) => p.id)).toEqual(["SOFT", "FIRM"]);
    expect(shown.some((p) => p.id === "MED")).toBe(false);
  });

  it("инструмент поиска объясняет пустую выдачу фактом, а не догадкой", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { category: "матрасы", hardness: "medium" },
      { catalog: CATALOG },
    );
    const payload = res.result as { returned: number; medium_mattresses_discontinued?: boolean };
    expect(payload.returned).toBe(0);
    expect(payload.medium_mattresses_discontinued).toBe(true);
  });

  it("на запрос про SOFT в выдаче нет пометки о снятой жёсткости", async () => {
    const res = await executeConsultantTool(
      "search_products",
      { category: "матрасы", hardness: "soft" },
      { catalog: CATALOG },
    );
    const payload = res.result as { medium_mattresses_discontinued?: boolean };
    expect(payload.medium_mattresses_discontinued).toBeUndefined();
  });
});

describe("механический запрет упоминания", () => {
  it("предложение снятого матраса считается упоминанием, честный отказ — нет", () => {
    expect(offersDiscontinuedMattress("Могу предложить Dorelan TRESOR R2 MEDIUM 160x200.")).toBe(
      true,
    );
    expect(offersDiscontinuedMattress("Есть матрас средней жёсткости за 950 000 тенге.")).toBe(
      true,
    );
    expect(offersDiscontinuedMattress("Матрасов средней жёсткости сейчас нет.")).toBe(false);
    expect(offersDiscontinuedMattress("Матрасы средней жёсткости сняты с производства.")).toBe(
      false,
    );
    expect(offersDiscontinuedMattress("Матрас Dorelan LEVANT R4 SOFT в наличии.")).toBe(false);
    expect(offersDiscontinuedMattress("Наматрасник Traumina MEDIUM в наличии.")).toBe(false);
    expect(offersDiscontinuedMattress("Матрас средней ценовой категории.")).toBe(false);
  });

  it("вырезает предложение со снятой жёсткостью и оставляет остальной ответ", () => {
    const text =
      "Матрас Dorelan LEVANT R4 SOFT 160x200 в наличии. Также есть TRESOR R2 MEDIUM средней жёсткости. Цена — 1 200 000 тенге.";
    expect(cleanDiscontinuedMattressOffers(text)).toBe(
      "Матрас Dorelan LEVANT R4 SOFT 160x200 в наличии. Цена — 1 200 000 тенге.",
    );
  });

  it("убирает строку списка целиком, не оставляя пустую", () => {
    const text =
      "Есть варианты:\nМатрас LEVANT R4 SOFT\nМатрас TRESOR R2 MEDIUM\nМатрас LEVANT R3 FIRM";
    expect(cleanDiscontinuedMattressOffers(text)).toBe(
      "Есть варианты:\nМатрас LEVANT R4 SOFT\nМатрас LEVANT R3 FIRM",
    );
  });

  it("честный отказ про среднюю жёсткость не режется", () => {
    const text = "Матрасов средней жёсткости сейчас нет. Есть SOFT и FIRM, показать?";
    expect(cleanDiscontinuedMattressOffers(text)).toBe(text);
  });

  it("готовый ответ на прямой вопрос не предлагает снятую жёсткость", () => {
    expect(offersDiscontinuedMattress(DISCONTINUED_MEDIUM_MATTRESS_REPLY)).toBe(false);
    expect(cleanDiscontinuedMattressOffers(DISCONTINUED_MEDIUM_MATTRESS_REPLY)).toBe(
      DISCONTINUED_MEDIUM_MATTRESS_REPLY,
    );
  });

  it("ответ модели проходит ту же чистку; ничего не осталось — честный отказ", () => {
    const reply = finalizePricelistText("Есть TRESOR R2 MEDIUM за 950 000 ₸.", CATALOG);
    expect(reply).toContain("Матрасов средней жёсткости сейчас нет");
    expect(reply).not.toContain("TRESOR");
  });
});

describe("отговорка про каталог", () => {
  it("вырезает фразу про то, что в каталоге чего-то не указано", () => {
    const text =
      "О полотенце ANTHEA DARK 75x150: К сожалению, в каталоге не указаны детальные характеристики этой конкретной модели. Это махровое полотенце из коллекции Feiler с зелёным цветом.";
    const cleaned = cleanCatalogExcuses(text);
    expect(cleaned).not.toMatch(/каталоге не указаны/i);
    expect(cleaned).toContain("Это махровое полотенце из коллекции Feiler");
  });

  it("узнаёт отговорку и не путает её с обычным ответом", () => {
    expect(isCatalogExcuse("В каталоге не указан состав.")).toBe(true);
    expect(isCatalogExcuse("У меня нет информации о составе этой модели.")).toBe(true);
    expect(isCatalogExcuse("Feiler — немецкий шенилл с плотным ворсом.")).toBe(false);
    expect(isCatalogExcuse("В каталоге 877 позиций.")).toBe(false);
  });

  it("если отговорка была всем ответом, текст остаётся — молчать нельзя", () => {
    const text = "В каталоге не указаны детальные характеристики.";
    expect(cleanCatalogExcuses(text)).toBe(text);
  });
});

describe("статьи базы знаний", () => {
  it("parses articles with tags from text", () => {
    const raw = `
### Фабрика в Португалии [португалия, фабрика, европа]
Премиальная линия BOVI производится на фабрике в Португалии.

### Сатин 300 TC [сатин, хлопок, 300tc]
Комплекты шьются из мерсеризованного хлопка высшего сорта.
`;
    const articles = parseKnowledgeArticlesFromText(raw);
    expect(articles).toHaveLength(2);
    expect(articles[0]!.title).toBe("Фабрика в Португалии");
    expect(articles[0]!.tags).toEqual(["португалия", "фабрика", "европа"]);
    expect(articles[0]!.content).toContain("Португалии");
    expect(articles[1]!.title).toBe("Сатин 300 TC");
    expect(articles[1]!.tags).toEqual(["сатин", "хлопок", "300tc"]);
  });

  it("formats knowledge articles for system prompt", () => {
    const promptText = formatKnowledgeForPrompt(DEFAULT_KNOWLEDGE_ARTICLES);
    expect(promptText).toContain("OEKO-TEX Standard 100");
    expect(promptText).toContain("Combed Cotton");
    expect(promptText).toContain("300 TC");
    expect(promptText).toContain("swan down");
  });
});

describe("повторное приветствие (BOVI 10.10, tolkin8)", () => {
  it("уже здоровались — «Здравствуйте.» в начале срезается", () => {
    expect(
      finalizePricelistText("Здравствуйте. Есть Uchino 50х100 — 9 000 ₸.", [], { greeted: true }),
    ).toBe("Есть Uchino 50х100 - 9 000 ₸.");
    expect(stripRepeatGreeting("Добрый день! Какой размер нужен?")).toBe("Какой размер нужен?");
    expect(stripRepeatGreeting("Сәлеметсіз бе, қандай өлшем керек?")).toBe("Қандай өлшем керек?");
  });

  it("первый ответ разговора и ответ из одного приветствия — как есть", () => {
    expect(finalizePricelistText("Здравствуйте. Что подсказать?", [])).toBe(
      "Здравствуйте. Что подсказать?",
    );
    expect(stripRepeatGreeting("Здравствуйте.")).toBe("Здравствуйте.");
    expect(stripRepeatGreeting("Здравствуйтеее")).toBe("Здравствуйтеее");
  });
});
