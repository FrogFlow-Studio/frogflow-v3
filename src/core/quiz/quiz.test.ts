import { describe, expect, it } from "vitest";
import { parseQuiz, scoreProducts, splitTags } from "./quiz";

describe("квиз-подбор", () => {
  it("теги: нижний регистр, без коротких и дублей", () => {
    expect(splitTags("Хлопок, лён; х, ХЛОПОК")).toEqual(["хлопок", "лён"]);
  });
  it("разбор: вопрос без двух вариантов и вариант без подписи выпадают", () => {
    const q = parseQuiz(
      JSON.stringify({
        questions: [
          {
            text: "Для кого?",
            options: [
              { label: "Детям", tags: "дети, детск" },
              { label: "Взрослым", tags: ["взросл"] },
            ],
          },
          { text: "Один вариант", options: [{ label: "A", tags: "a" }] },
          { text: "", options: [{ label: "A" }, { label: "B" }] },
        ],
      }),
    );
    expect(q.questions).toHaveLength(1);
    expect(q.questions[0]!.options[0]!.tags).toEqual(["дети", "детск"]);
  });
  it("очки за совпавшие теги, лучшие первыми, ноль очков — мимо", () => {
    const ps = [
      { id: "1", name: "Прописи для детей", keywords: "детск", description: null },
      { id: "2", name: "Пазлы", keywords: null, description: "для детей 3+" },
      { id: "3", name: "Ежедневник", keywords: "взросл", description: null },
    ];
    expect(scoreProducts(ps, ["дет", "пропис"]).map((p) => p.id)).toEqual(["1", "2"]);
    expect(scoreProducts(ps, ["космос"])).toEqual([]);
  });
});
