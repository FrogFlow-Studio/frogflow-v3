import { describe, expect, it } from "vitest";
import { LESSONS_MAX, parseCourseOutline } from "./course";

describe("parseCourseOutline — план курса в мастере «Новый курс»", () => {
  it("заголовок «Модуль 1:» становится частью названий уроков под ним", () => {
    const r = parseCourseOutline(
      [
        "Модуль 1. Основы:",
        "Материалы — https://youtu.be/a1",
        "Рабочее место — https://vimeo.com/2",
        "",
        "Модуль 2:",
        "Классика 1:1 — https://youtu.be/b2",
      ].join("\n"),
    );
    expect(r.modules).toBe(2);
    expect(r.skipped).toEqual([]);
    expect(r.lessons).toEqual([
      { title: "Модуль 1. Основы · Материалы", link: "https://youtu.be/a1" },
      { title: "Модуль 1. Основы · Рабочее место", link: "https://vimeo.com/2" },
      { title: "Модуль 2 · Классика 1:1", link: "https://youtu.be/b2" },
    ]);
  });

  it("без заголовков — обычный список уроков", () => {
    const r = parseCourseOutline("Урок 1 — https://youtu.be/x\nУрок 2 — https://youtu.be/y");
    expect(r.modules).toBe(0);
    expect(r.lessons.map((l) => l.title)).toEqual(["Урок 1", "Урок 2"]);
  });

  it("урок без ссылки не берётся: пустой урок курс не сохранит", () => {
    const r = parseCourseOutline("Урок 1 — https://youtu.be/x\nУрок 2");
    expect(r.lessons).toHaveLength(1);
    expect(r.skipped).toEqual([{ line: 2, reason: "noLink" }]);
  });

  it("строка с не-https ссылкой не теряется молча: номер строки и причина", () => {
    const r = parseCourseOutline("Модуль 1:\nУрок — http://site.kz/v\nУрок 2 — https://youtu.be/2");
    expect(r.lessons).toEqual([{ title: "Модуль 1 · Урок 2", link: "https://youtu.be/2" }]);
    expect(r.skipped).toEqual([{ line: 2, reason: "notHttps" }]);
  });

  it("ссылка с двоеточием на конце — не заголовок модуля", () => {
    const r = parseCourseOutline("https://youtu.be/x:");
    expect(r.modules).toBe(0);
    expect(r.lessons).toEqual([]);
    expect(r.skipped).toEqual([{ line: 1, reason: "noTitle" }]);
  });

  it("сверх лимита уроков — счёт в overLimit", () => {
    const text = Array.from(
      { length: LESSONS_MAX + 3 },
      (_, i) => `Урок ${i + 1} — https://youtu.be/${i}`,
    ).join("\n");
    const r = parseCourseOutline(text);
    expect(r.lessons).toHaveLength(LESSONS_MAX);
    expect(r.overLimit).toBe(3);
  });

  it("слишком длинное название вместе с модулем — строка пропущена с причиной", () => {
    const r = parseCourseOutline(`${"М".repeat(70)}:\n${"У".repeat(190)} — https://youtu.be/x`);
    expect(r.lessons).toEqual([]);
    expect(r.skipped).toEqual([{ line: 2, reason: "titleTooLong" }]);
  });
});
