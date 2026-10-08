import { describe, expect, it } from "vitest";
import {
  TOPICS_MAX,
  cleanTopics,
  joinKeywords,
  keywordWords,
  splitKeywords,
  topicSuggestions,
  withTopic,
} from "./topics";

describe("тема в ключевых словах", () => {
  it("слова и темы разделяются и собираются обратно", () => {
    const kw = joinKeywords("пропись, 1 класс", ["1 сентября", "Части речи"]);
    expect(kw).toBe("пропись, 1 класс #тема: 1 сентября, Части речи");
    expect(splitKeywords(kw)).toEqual({
      words: "пропись, 1 класс",
      topics: ["1 сентября", "Части речи"],
    });
  });

  it("без тем ключевые слова не меняются, метка в словах руками не дублируется", () => {
    expect(joinKeywords("пропись", [])).toBe("пропись");
    expect(splitKeywords("пропись")).toEqual({ words: "пропись", topics: [] });
    expect(joinKeywords("пропись #тема: старая", ["новая"])).toBe("пропись #тема: новая");
    expect(joinKeywords("", ["1 сентября"])).toBe("#тема: 1 сентября");
  });

  it("повторы тем без учёта регистра, ё и пробелов отбрасываются; не больше лимита", () => {
    expect(cleanTopics("Ёлка, елка ,  1  сентября, 1 Сентября,, #осень")).toEqual([
      "Ёлка",
      "1 сентября",
      "осень",
    ]);
    expect(cleanTopics(Array.from({ length: 15 }, (_, i) => `т${i}`))).toHaveLength(TOPICS_MAX);
  });

  it("массово: добавить тему, не задвоить, убрать", () => {
    expect(withTopic("пропись", "1 сентября", "add")).toBe("пропись #тема: 1 сентября");
    expect(withTopic("пропись #тема: 1 Сентября", "1 сентября", "add")).toBeNull();
    expect(withTopic("пропись #тема: 1 сентября, осень", "1 СЕНТЯБРЯ", "remove")).toBe(
      "пропись #тема: осень",
    );
    expect(withTopic("пропись #тема: осень", "осень", "remove")).toBe("пропись");
    expect(withTopic("пропись", "осень", "remove")).toBeNull();
    expect(withTopic("пропись", "  ", "add")).toBeNull();
  });

  it("значимые слова — без тем, чисел и кодов", () => {
    expect([...keywordWords("Дроби, 5 класс, кпп2024, ок #тема: осень")]).toEqual([
      "дроби",
      "класс",
    ]);
  });

  it("подсказки — по частоте, написание самое частое", () => {
    expect(
      topicSuggestions([
        "#тема: осень",
        "а #тема: 1 сентября",
        "#тема: 1 Сентября",
        "#тема: 1 сентября, осень",
        "#тема: 1 сентября",
        null,
      ]),
    ).toEqual(["1 сентября", "осень"]);
  });
});
