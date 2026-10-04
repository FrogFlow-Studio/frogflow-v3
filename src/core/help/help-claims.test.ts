import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import * as helpDict from "@/app/i18n/admin/help";
import * as newsDict from "@/app/i18n/admin/news";
import { HELP_ARTICLES, helpSlugs } from "./articles";

/**
 * П3 (партия 20): «Помощь» и лента новостей. Полнота четырёх языков (статьи и
 * словари интерфейса) и отсутствие описаний функций, которых нет в коде:
 * комиссия, роль «Администратор», награда за отзыв. Когда функция появится
 * в коде, её слово убирается отсюда в том же PR, где пишется статья.
 */
const DICTS = { help: helpDict, news: newsDict } as const;

describe("словари «Помощи» и новостей: четыре языка", () => {
  for (const [name, d] of Object.entries(DICTS))
    it(`${name}: у каждого ключа есть kk, en и uz, и они переведены`, () => {
      const ru = d.ru as Record<string, string>;
      for (const l of ["kk", "en", "uz"] as const) {
        const t = d[l] as Record<string, string>;
        expect(Object.keys(t).sort(), `${name}.${l}: набор ключей`).toEqual(Object.keys(ru).sort());
        for (const k of Object.keys(ru)) {
          expect(t[k]?.trim(), `${name}.${l}.${k}`).toBeTruthy();
          expect(t[k], `${name}.${l}.${k}: не переведено`).not.toBe(ru[k]);
        }
      }
    });
});

/** Слова из тем, которых в коде нет (или они не для продавца): в «Помощи» им не место. */
const NOT_IN_CODE: Array<{ topic: string; re: RegExp }> = [
  { topic: "комиссия платформы", re: /комисси|commission|komissiya/i },
  {
    topic: "роль «Администратор» в команде",
    re: /роль\s+«?администратор|administrator role|administrator roli/i,
  },
  {
    topic: "награда за отзыв",
    re: /(награ|бонус|баллы?)\w*\s+за\s+отзыв|reward\w*\s+for\s+(a\s+)?review|sharh uchun\s+(mukofot|bonus)|пікір үшін\s+(сыйақы|бонус)/i,
  },
];

describe("«Помощь» не описывает того, чего нет в коде", () => {
  it("статьи: у каждой темы четыре языка, запрещённых описаний нет", () => {
    for (const slug of helpSlugs())
      for (const l of SUPPORTED_LOCALES) {
        const a = HELP_ARTICLES.find((x) => x.slug === slug && x.locale === l);
        expect(a, `${slug}: нет ${l}`).toBeTruthy();
        const text = `${a!.title}\n${a!.keywords.join(" ")}\n${a!.body}`;
        for (const f of NOT_IN_CODE)
          expect(text, `${slug}.${l}: описана функция «${f.topic}»`).not.toMatch(f.re);
      }
  });

  it("словари интерфейса «Помощи» и новостей тоже без них", () => {
    for (const [name, d] of Object.entries(DICTS))
      for (const l of SUPPORTED_LOCALES) {
        const dict = (d as unknown as Record<string, Record<string, string>>)[l]!;
        const text = Object.values(dict).join("\n");
        for (const f of NOT_IN_CODE)
          expect(text, `${name}.${l}: описана функция «${f.topic}»`).not.toMatch(f.re);
      }
  });
});
