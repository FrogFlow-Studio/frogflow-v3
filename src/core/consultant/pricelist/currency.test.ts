import { describe, it, expect } from "vitest";
import { currencyAsked, tengeToRubles, wantsRubles } from "./currency";
import { russianPlaceIn } from "./geo";
import { priceRub } from "./rate";

/**
 * 25.09, тест на прайсе BOVI: на «сколько в рублях?» модель назвала рубли
 * одиннадцати подушкам, шесть — чужие (SENSE LOW за 85 000 ₸ — «4 494 ₽»
 * стаканчика Blomus). Тенге были верные. В v2 рубли считает код.
 */
describe("tengeToRubles", () => {
  const rate = 4.45;
  const rub = (kzt: number) => `${priceRub(kzt, rate).toLocaleString("ru-RU")} ₽`;

  it("каждая сумма в тенге — в рубли по формуле магазина", () => {
    const text = "• SENSE LOW — 85 000 ₸\n• Swing Extra Light — 50 000 ₸";
    expect(tengeToRubles(text, rate)).toBe(
      `• SENSE LOW — ${rub(85000)}\n• Swing Extra Light — ${rub(50000)}`,
    );
  });

  it("понимает неразрывные пробелы, «тг» и «тенге»", () => {
    expect(tengeToRubles("85 000 ₸", rate)).toBe(rub(85000));
    expect(tengeToRubles("за 27000 тг", rate)).toBe(`за ${rub(27000)}`);
    expect(tengeToRubles("всего 79 000 тенге", rate)).toBe(`всего ${rub(79000)}`);
  });

  it("диапазон со знаком у второй суммы — в рублях обе (BOVI 04.10)", () => {
    expect(tengeToRubles("от 242 000 до 262 000 ₸", rate)).toBe(
      `от ${rub(242000)} до ${rub(262000)}`,
    );
    expect(tengeToRubles("45 000–52 000 ₸", rate)).toBe(`${rub(45000)}–${rub(52000)}`);
    expect(tengeToRubles("70х140 - 15 000 ₸", rate)).toBe(`70х140 - ${rub(15000)}`);
  });

  it("размеры и другие числа не трогает; без курса текст прежний", () => {
    expect(tengeToRubles("50х100, 2 шт", rate)).toBe("50х100, 2 шт");
    expect(tengeToRubles("85 000 ₸", null)).toBe("85 000 ₸");
  });
});

describe("wantsRubles", () => {
  it("попросил рубли — рубли и дальше, попросил тенге — обратно", () => {
    expect(wantsRubles("сколько в рублях?", {}, undefined)).toBe(true);
    expect(wantsRubles("а белые есть?", { v2_rub: true }, undefined)).toBe(true);
    expect(wantsRubles("а в тенге?", { v2_rub: true }, undefined)).toBe(false);
    expect(wantsRubles("Доставка в Россию есть?", {}, undefined)).toBe(true);
  });

  it("покупатель сказал, что он из России", () => {
    expect(wantsRubles("белые есть?", {}, { country: "Россия" })).toBe(true);
    expect(wantsRubles("белые есть?", {}, { country: "Казахстан" })).toBe(false);
    expect(wantsRubles("белые есть?", {}, undefined)).toBe(false);
  });
});

/**
 * 27.09, живой диалог BOVI: «стоимость доставки в Москву?» — страну модель не
 * запомнила, и цены клиентке из Москвы ушли в тенге.
 */
describe("russianPlaceIn", () => {
  it("город России в любом падеже — Россия и город", () => {
    expect(russianPlaceIn("Доброго дня. Подскажите стоимость доставки в Москву? И сроки.")).toEqual(
      { country: "Россия", city: "Москва" },
    );
    expect(russianPlaceIn("В Московскую обл.отправляете?")).toEqual({
      country: "Россия",
      city: "Москва",
    });
    expect(russianPlaceIn("я из Питера")).toEqual({ country: "Россия", city: "Санкт-Петербург" });
    expect(russianPlaceIn("отправите в Екатеринбург?")?.city).toBe("Екатеринбург");
    expect(russianPlaceIn("Доставка по России есть?")).toEqual({ country: "Россия" });
  });

  it("не Россия: Казахстан рядом или похожие слова", () => {
    expect(russianPlaceIn("Я в Алматы, можно отправить подарок в Москву?")).toBeNull();
    expect(russianPlaceIn("Семейный комплект есть?")).toBeNull();
    expect(russianPlaceIn("Уфф, дорого")).toBeNull();
    expect(russianPlaceIn("Здравствуйте, цену коврика для ванной")).toBeNull();
  });
});

describe("currencyAsked", () => {
  it("российский город — рубли; тенге в том же сообщении важнее", () => {
    expect(currencyAsked("Доставка в Москву есть?")).toBe(true);
    expect(currencyAsked("Я в Москве, но цены в тенге")).toBe(false);
    expect(currencyAsked("а белые есть?")).toBeUndefined();
    expect(wantsRubles("Доставка в Москву есть?", {}, undefined)).toBe(true);
  });
});
