import { describe, expect, it } from "vitest";
import { matchSectionName, sectionWords } from "./section-name";

// Настоящие названия разделов верхнего уровня (база, 11.10).
const AATEACH = [
  "🇰🇿 ДЕНЬ РЕСПУБЛИКИ",
  "🌍День ЯЗЫКОВ",
  "🌸День МАТЕРИ",
  "🌻День пожилых",
  "🍁 1 СЕНТЯБРЯ",
  "🍂 Праздник ОСЕНИ",
  "🏅 Грамоты, дипломы и обложки",
  "🏫НАЧАЛЬНАЯ ШКОЛА (1-4 классы)",
  "👨‍👩‍👦 День СЕМЬИ",
  "👩‍🏫 ДЕНЬ УЧИТЕЛЯ",
  "📅 ПРАЗДНИКИ И КЛАССНЫЕ ЧАСЫ",
  "🥨День ХЛЕБА",
  "🧸 ДЕТСКИЙ САД И ДОШКОЛЬНИКИ",
].map((name, i) => ({ id: `a${i}`, name }));
// Подразделы «Начальной школы» с повтором названия, как в базе.
const AATEACH_SCHOOL = [
  "✍️ Основы грамоты и чтения",
  "✍️ Русский язык и чтение",
  "🔢 Математика",
  "🔢 Математика и логика",
  "🌍 Окружающий мир и др. предметы",
].map((name, i) => ({ id: `s${i}`, name }));
const KOPILKA = [
  "Классному руководителю",
  "Оформление и праздники",
  "Папки ",
  "Педагогам",
  "Русоведам",
].map((name, i) => ({ id: `k${i}`, name }));

const id = (text: string, list: Array<{ id: string; name: string }>) =>
  matchSectionName(text, list);

describe("раздел по названию", () => {
  it("эмодзи, скобки и капс не мешают (AATeach, 11.10: «Начальная школа» ×4)", () => {
    expect(id("Начальная школа", AATEACH)).toEqual({ id: "a7", exact: true });
    expect(id("начальная школа", AATEACH)).toEqual({ id: "a7", exact: true });
    expect(id("НАЧАЛЬНАЯ ШКОЛА (1-4 классы)", AATEACH)).toEqual({ id: "a7", exact: true });
    expect(id("День хлеба", AATEACH)).toEqual({ id: "a11", exact: true });
    expect(id("день учителя!", AATEACH)).toEqual({ id: "a9", exact: true });
    expect(id("1 сентября", AATEACH)).toEqual({ id: "a4", exact: true });
  });

  it("слова «раздел», «категория» (с опечаткой) вокруг названия", () => {
    expect(id("Категоря начальная школа", AATEACH)).toEqual({ id: "a7", exact: true });
    expect(id("Раздел: День матери", AATEACH)).toEqual({ id: "a2", exact: true });
  });

  it("другой падеж и лишние слова — неточно, но раздел найден", () => {
    expect(id("Покажите начальную школу", AATEACH)).toEqual({ id: "a7", exact: false });
    expect(id("Начальная школа 2 класс", AATEACH)).toEqual({ id: "a7", exact: false });
  });

  it("часть названия, если подходит ровно один раздел", () => {
    expect(id("Грамоты", AATEACH)).toEqual({ id: "a6", exact: false });
    expect(id("Хлеба", AATEACH)).toEqual({ id: "a11", exact: false });
    expect(id("Дошкольники", AATEACH)).toEqual({ id: "a12", exact: false });
  });

  it("слово из многих разделов не открывает ни один", () => {
    expect(id("День", AATEACH)).toBeNull();
    expect(id("Праздники", AATEACH)).toBeNull(); // «Праздник ОСЕНИ», «ПРАЗДНИКИ И КЛАССНЫЕ ЧАСЫ»
  });

  it("длинное название важнее короткого, повтор названия — не находит", () => {
    expect(id("Математика и логика", AATEACH_SCHOOL)).toEqual({ id: "s3", exact: true });
    expect(id("Математика", AATEACH_SCHOOL)).toEqual({ id: "s2", exact: true });
    expect(id("Русский язык", AATEACH_SCHOOL)).toEqual({ id: "s1", exact: false });
    expect(
      id("Математика", [
        { id: "x", name: "🔢 Математика" },
        { id: "y", name: "🔢 Математика" },
      ]),
    ).toBeNull();
  });

  it("Копилка: название, номер пункта и пробел в конце", () => {
    expect(id("Оформление и праздники", KOPILKA)).toEqual({ id: "k1", exact: true });
    expect(id("4. Русоведам", KOPILKA)).toEqual({ id: "k4", exact: true });
    expect(id("папки", KOPILKA)).toEqual({ id: "k2", exact: true });
  });

  it("название правила рядом с похожим разделом — только неточно (уступает правилу)", () => {
    expect(id("Папка профориентатора", KOPILKA)).toEqual({ id: "k2", exact: false });
    expect(id("Палитра", KOPILKA)).toBeNull();
    expect(id("Пицца", AATEACH)).toBeNull();
  });

  it("короткое и пустое — мимо", () => {
    expect(id("да", AATEACH)).toBeNull();
    expect(id("🙂", AATEACH)).toBeNull();
    expect(id("3", AATEACH)).toBeNull();
    expect(sectionWords("🏫НАЧАЛЬНАЯ ШКОЛА (1-4 классы)")).toEqual(["начальная", "школа"]);
  });
});
