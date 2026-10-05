import { describe, expect, it } from "vitest";
import { STOREFRONT_KEYS, storefrontT } from "./storefront";
import { SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";
import { MARKET_KEYS, marketT } from "@/app/market/i18n";
import { REORDER_KEYS, reorderT } from "@/app/market/reorder-i18n";
import { FAVORITE_KEYS, favoriteT } from "@/app/market/favorite-i18n";
import { OPEN_KEYS, openT } from "@/app/market/open-i18n";
import { REPORT_KEYS, reportT } from "@/app/market/report-i18n";
import { RULES_KEYS, rulesT } from "@/app/market/rules-i18n";

/**
 * Строки витрины и площадки писались десятками PR, и язык мог «потеряться» двумя способами:
 * ключа нет в переводе (переводчик молча отдаёт русский) или перевод скопирован с английского
 * либо русского. Скан идёт по всем ключам русского словаря на всех четырёх языках.
 */
type Dict = { name: string; keys: readonly string[]; t: (l: Locale) => (k: never) => string };
const DICTS: Dict[] = [
  { name: "витрина", keys: STOREFRONT_KEYS, t: (l) => storefrontT(l) as never },
  { name: "площадка", keys: MARKET_KEYS, t: (l) => marketT(l) as never },
  { name: "«Открыть магазин»", keys: OPEN_KEYS, t: (l) => openT(l) as never },
  { name: "заказать снова", keys: REORDER_KEYS, t: (l) => reorderT(l) as never },
  { name: "избранное площадки", keys: FAVORITE_KEYS, t: (l) => favoriteT(l) as never },
  { name: "жалоба", keys: REPORT_KEYS, t: (l) => reportT(l) as never },
  { name: "правила", keys: RULES_KEYS, t: (l) => rulesT(l) as never },
];

const hasLetters = (s: string) => /[\p{L}]{3,}/u.test(s.replace(/\{[^}]+\}/g, ""));
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Строки, которые честно совпадают на нескольких языках: название продукта, общеупотребительное
 * слово. Новое исключение — осознанное решение и строка здесь с причиной.
 */
const SAME: Record<string, string> = {
  "витрина:order.courier.indrive": "название сервиса inDrive пишется одинаково",
  "витрина:product.variant": "«Variant» — принятое в узбекском слово, как в английском",
  "«Открыть магазин»:tier.basic": "название тарифа Basic",
  "«Открыть магазин»:tier.pro": "название тарифа Pro",
  "«Открыть магазин»:tier.business": "название тарифа Business",
  "«Открыть магазин»:field.instagram": "название сети Instagram",
};

describe.each(DICTS)("строки: $name", ({ name, keys, t }) => {
  const ru = t("ru");
  it("на каждом языке свои значения: не пусто, не равно ключу", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of keys) {
        const v = t(l)(k as never);
        expect(v, `${l}: ${k}`).toBeTruthy();
        expect(v, `${l}: ${k}`).not.toBe(k);
      }
  });

  it("kk и uz не повторяют английский (русские слова в kk законны: кириллица общая)", () => {
    const same: string[] = [];
    for (const k of keys) {
      const [kk, en, uz] = (["kk", "en", "uz"] as const).map((l) => t(l)(k as never));
      if (!hasLetters(en!) || SAME[`${name}:${k}`]) continue;
      if (kk === en) same.push(`kk=en ${k}`);
      if (uz === en) same.push(`uz=en ${k}`);
    }
    expect(same, "переведите строку или впишите в SAME с причиной").toEqual([]);
  });

  it("в английском и узбекском нет кириллицы (пропущенный русский текст)", () => {
    const bad: string[] = [];
    for (const l of ["en", "uz"] as const)
      for (const k of keys) if (CYRILLIC.test(t(l)(k as never))) bad.push(`${l}: ${k}`);
    expect(bad).toEqual([]);
  });

  it("в казахском есть кириллица: чисто латинская строка — не переведена", () => {
    const bad: string[] = [];
    for (const k of keys) {
      const v = t("kk")(k as never);
      if (hasLetters(v) && !CYRILLIC.test(v) && !SAME[`${name}:${k}`]) bad.push(k);
    }
    expect(bad).toEqual([]);
  });

  it("подстановки {x} одинаковы на всех языках", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const diff: string[] = [];
    for (const k of keys)
      for (const l of ["kk", "en", "uz"] as const)
        if (JSON.stringify(vars(t(l)(k as never))) !== JSON.stringify(vars(ru(k as never))))
          diff.push(`${l}: ${k}`);
    expect(diff).toEqual([]);
  });
});

describe("сам скан", () => {
  it("видит повторы: одинаковая строка и пустая цифровая не считаются переводом", () => {
    expect(hasLetters("{n} 12")).toBe(false);
    expect(hasLetters("Report")).toBe(true);
    expect(CYRILLIC.test("Привет")).toBe(true);
  });
});
