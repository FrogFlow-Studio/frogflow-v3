import { describe, expect, it } from "vitest";
import {
  LANDING_BLOCKS,
  LANDING_LIMITS,
  draftFromCourse,
  emptyLanding,
  landingKey,
  normalOrder,
  parseLanding,
  programModules,
  visibleBlocks,
  type DraftTexts,
} from "./landing";

const T = "637dc035-3267-4d7e-a2d0-3baae6a5f8c8";
const OTHER = "11111111-1111-4111-8111-111111111111";

describe("страница курса: разбор записи (03.11.2026, Lash Academy)", () => {
  it("нет записи или битая — страница выключена, товар как раньше", () => {
    expect(parseLanding(null, T)).toEqual(emptyLanding());
    expect(parseLanding("{oops", T).on).toBe(false);
    expect(parseLanding("[1,2]", T).on).toBe(false);
    expect(landingKey("p1")).toBe("course_landing_p1");
  });

  it("фото с чужим префиксом отбрасываются, пустые пункты — тоже", () => {
    const l = parseLanding(
      JSON.stringify({
        on: true,
        theme: "bold",
        accent: "#C2185B",
        authors: [
          { photo: `${OTHER}/x.jpg`, name: "Жази", text: "" },
          { photo: null, name: "", text: "" },
        ],
        works: [`${T}/a.jpg`, `${OTHER}/b.jpg`, `${T}/a.jpg`, "../etc"],
        learn: ["Классика", "  ", 5],
        quotes: [{ name: "Аня", text: "" }],
        faq: [
          { q: "Вопрос", a: "" },
          { q: "Как?", a: "Так" },
        ],
      }),
      T,
    );
    expect(l.on).toBe(true);
    expect(l.theme).toBe("bold");
    expect(l.accent).toBe("#C2185B");
    expect(l.authors).toEqual([{ photo: null, name: "Жази", text: "" }]);
    expect(l.works).toEqual([`${T}/a.jpg`]);
    expect(l.learn).toEqual(["Классика"]);
    expect(l.quotes).toEqual([]);
    expect(l.faq).toEqual([{ q: "Как?", a: "Так" }]);
  });

  it("неизвестная тема, плохой цвет и лишние пункты приводятся к пределам", () => {
    const l = parseLanding(
      JSON.stringify({
        theme: "neon",
        accent: "red; background:url(x)",
        learn: Array.from({ length: 40 }, (_, i) => `п${i}`),
        headline: "x".repeat(500),
      }),
      T,
    );
    expect(l.theme).toBe("soft");
    expect(l.accent).toBeNull();
    expect(l.learn).toHaveLength(LANDING_LIMITS.learn);
    expect(l.headline).toHaveLength(LANDING_LIMITS.headline);
  });

  it("порядок блоков без повторов, недостающие — в конец", () => {
    expect(normalOrder(["faq", "faq", "bogus", "authors"])).toEqual([
      "faq",
      "authors",
      ...LANDING_BLOCKS.filter((b) => b !== "faq" && b !== "authors"),
    ]);
  });
});

describe("страница курса: что видит покупатель", () => {
  it("скрытые и пустые блоки не показываются, порядок — продавца", () => {
    const l = {
      ...emptyLanding(),
      order: normalOrder(["faq", "learn", "works"]),
      hidden: ["learn" as const],
      learn: ["a"],
      faq: [{ q: "q", a: "a" }],
    };
    // works пустой (нет фото) — скрыт сам; learn выключен продавцом.
    expect(visibleBlocks(l, { program: true })).toEqual(["faq", "program"]);
    expect(visibleBlocks(l, { program: false })).toEqual(["faq"]);
  });

  it("программа по модулям из названий «Модуль N · N.M. …»", () => {
    const g = programModules([
      { no: 1, title: "Модуль 1 · 1.1. Знакомство" },
      { no: 2, title: "Модуль 1 · 1.2. Материалы" },
      { no: 3, title: "Модуль 2 · 2.1. Классика" },
    ]);
    expect(g.map((m) => [m.title, m.lessons.map((l) => l.short)])).toEqual([
      ["Модуль 1", ["1.1. Знакомство", "1.2. Материалы"]],
      ["Модуль 2", ["2.1. Классика"]],
    ]);
    expect(programModules([{ no: 1, title: "Вводный урок" }])).toEqual([
      { title: null, lessons: [{ no: 1, title: "Вводный урок", short: "Вводный урок" }] },
    ]);
  });
});

const texts: DraftTexts = {
  subtitle: (n, m) => `${n}/${m}`,
  faqFormatQ: "format?",
  faqFormatA: (n) => `lessons ${n}`,
  faqHomeworkQ: "hw?",
  faqHomeworkA: "hw",
  faqAccessQ: "access?",
  faqAccessA: (d) => (d ? `${d} days` : "forever"),
  faqFreeQ: "free?",
  faqFreeA: "free",
};

describe("«Заполнить из курса»", () => {
  const lessons = [
    { title: "Модуль 1 · 1.1. Знакомство с профессией", homework: false, preview: true },
    { title: "Модуль 1 · 1.2. Материалы и инструменты", homework: true, preview: false },
    { title: "Модуль 2 · 2.1. Классическое наращивание 1:1", homework: false, preview: false },
  ];

  it("черновик из уроков: подзаголовок, «Чему научитесь», вопросы по настроенному", () => {
    const prev = {
      ...emptyLanding(),
      authors: [{ photo: null, name: "Айс", text: "" }],
      works: [`${T}/w.jpg`],
    };
    const d = draftFromCourse(prev, { productName: "Курс", lessons, accessDays: null }, texts);
    expect(d.on).toBe(true);
    expect(d.headline).toBe("Курс");
    expect(d.subtitle).toBe("3/2");
    expect(d.learn).toEqual([
      "Знакомство с профессией",
      "Материалы и инструменты",
      "Классическое наращивание 1:1",
    ]);
    expect(d.faq.map((f) => f.q)).toEqual(["format?", "hw?", "access?", "free?"]);
    expect(d.faq[2]!.a).toBe("forever");
    // Своё продавца не трогается.
    expect(d.authors).toEqual(prev.authors);
    expect(d.works).toEqual(prev.works);
  });

  it("без ДЗ и открытого урока такие вопросы не пишутся; разный срок у тарифов — без вопроса о сроке", () => {
    const plain = lessons.map((l) => ({ ...l, homework: false, preview: false }));
    const d = draftFromCourse(
      { ...emptyLanding(), headline: "Свой заголовок" },
      { productName: "Курс", lessons: plain, accessDays: undefined },
      texts,
    );
    expect(d.headline).toBe("Свой заголовок");
    expect(d.faq.map((f) => f.q)).toEqual(["format?"]);
  });
});
