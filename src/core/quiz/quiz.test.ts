import { describe, expect, it } from "vitest";
import { parseQuiz, quizAnswer, scoreProducts, splitTags, tagsForAnswers, type Quiz } from "./quiz";

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

const QUIZ: Quiz = {
  intro: "",
  questions: [
    {
      text: "Для кого?",
      options: [
        { label: "Детям", tags: ["дет"] },
        { label: "Взрослым", tags: ["взросл"] },
      ],
    },
    {
      text: "Что нужно?",
      options: [
        { label: "Прописи", tags: ["пропис"] },
        { label: "Пазлы", tags: ["пазл"] },
      ],
    },
  ],
};

describe("квиз: ответы в теги (одно место для всех каналов)", () => {
  it("теги копятся от вопроса к вопросу, последний вопрос — конец", () => {
    const a = quizAnswer(QUIZ, [], 0, 0)!;
    expect(a).toEqual({ tags: ["дет"], next: 1, done: false });
    expect(quizAnswer(QUIZ, a.tags, 1, 1)).toEqual({ tags: ["дет", "пазл"], next: 2, done: true });
  });

  it("ответ на первый вопрос начинает подбор заново; нет вопроса или варианта — null", () => {
    expect(quizAnswer(QUIZ, ["старый"], 0, 1)!.tags).toEqual(["взросл"]);
    expect(quizAnswer(QUIZ, [], 2, 0)).toBeNull();
    expect(quizAnswer(QUIZ, [], 0, 2)).toBeNull();
    expect(quizAnswer(QUIZ, [], 0, -1)).toBeNull();
    expect(quizAnswer(QUIZ, [], 0.5, 0)).toBeNull();
  });

  it("полный набор ответов даёт те же теги, что шаги по очереди; неполный или неверный — null", () => {
    expect(tagsForAnswers(QUIZ, [0, 1])).toEqual(["дет", "пазл"]);
    expect(tagsForAnswers(QUIZ, [0])).toBeNull();
    expect(tagsForAnswers(QUIZ, [0, 1, 0])).toBeNull();
    expect(tagsForAnswers(QUIZ, [0, 7])).toBeNull();
    expect(tagsForAnswers({ intro: "", questions: [] }, [])).toBeNull();
  });

  it("теги поздних вопросов не теряются: потолок в 10 тегов — для ввода продавца, не для подсчёта", () => {
    const many = Array.from({ length: 12 }, (_, i) => `тег${i}`);
    const ps = [{ id: "1", name: "Целевой товар", keywords: "поздний", description: null }];
    expect(scoreProducts(ps, [...many, "поздний"]).map((p) => p.id)).toEqual(["1"]);
    expect(splitTags(many.join(","))).toHaveLength(10);
  });
});
