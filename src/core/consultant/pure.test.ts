import { describe, expect, it } from "vitest";
import { parseKnowledge, retrieveKnowledge, tokenize } from "./knowledge";
import { parseProfile } from "./profile";
import { buildSystemPrompt, cleanReply, isResetIntent } from "./prompt";

const docs = parseKnowledge(
  JSON.stringify([
    {
      title: "Доставка и оплата",
      content: "Курьер по Алматы 1500 ₸, Kaspi QR.",
      tags: ["доставка"],
    },
    { title: "Витамин D3", content: "60 капсул, 7500 ₸", category: "Витамины" },
    { title: "", content: "" },
    "мусор",
  ]),
);

describe("knowledge", () => {
  it("парсит документы и выкидывает пустые", () => {
    expect(docs).toHaveLength(2);
    expect(docs[0]!.id).toBe("doc1");
    expect(parseKnowledge("{oops")).toEqual([]);
  });
  it("отбирает по словам запроса, иначе даёт общие", () => {
    expect(tokenize("Сколько стоит доставка по Алматы?")).toEqual([
      "сколько",
      "стоит",
      "доставка",
      "алматы",
    ]);
    expect(retrieveKnowledge("доставка", docs, 1)[0]!.title).toBe("Доставка и оплата");
    expect(retrieveKnowledge("d3 витамин", docs, 1)[0]!.title).toBe("Витамин D3");
    expect(retrieveKnowledge("???", docs, 1)).toHaveLength(1);
  });
});

describe("profile / prompt", () => {
  it("профиль по умолчанию и разбор с защитой от мусора", () => {
    const p = parseProfile(
      '{"brand_name":" Bloom ","goal":"nope","currency":"usd","countries":[]}',
      "Магазин",
    );
    expect(p.brand_name).toBe("Bloom");
    expect(p.goal).toBe("direct_sales");
    expect(p.currency).toBe("USD");
    expect(p.countries).toEqual(["KZ"]);
    expect(parseProfile(null, "Магазин").brand_name).toBe("Магазин");
  });
  it("промпт содержит роль, цель, каталог и базу знаний", () => {
    const s = buildSystemPrompt(parseProfile(null, "Bloom"), docs, "- Роза, 5000 KZT");
    expect(s).toContain("«Bloom»");
    expect(s).toContain("ГЛАВНАЯ ЦЕЛЬ — ПРОДАЖА");
    expect(s).toContain("КАТАЛОГ");
    expect(s).toContain("[ДОКУМЕНТ: Витамин D3");
  });
  it("чистит markdown и сценарии", () => {
    expect(cleanReply("**Да**, есть.\nКлиент: беру\nАссистент: ок\n\n\n\n_итого_ 5")).toBe(
      "Да, есть.\n\nитого 5",
    );
    expect(isResetIntent("/reset")).toBe(true);
    expect(isResetIntent("сброс")).toBe(true);
    expect(isResetIntent("хочу сброс цены")).toBe(false);
  });
});
