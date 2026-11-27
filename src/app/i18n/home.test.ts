import { describe, expect, it } from "vitest";
import { HOME_KEYS, homeT } from "./home";
import { BRAND } from "@/app/landing/brand";
import { CLIENTS } from "@/app/landing/config";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

describe("словарь главной Enveriq", () => {
  it("ни один ключ не пропущен ни в одном языке и не остаётся подстановок, кроме переменных", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = homeT(l, BRAND.name);
      for (const k of HOME_KEYS) {
        const s = t(k);
        expect(s, `${l}: ${k}`).toBeTruthy();
        expect(s, `${l}: ${k}`).not.toBe(k);
        expect(s, `${l}: ${k}`).not.toContain("{brand}");
      }
    }
  });

  it("имя продукта приходит из бренда: смена имени не требует правки переводов", () => {
    expect(homeT("ru", "Enveriq")("proof.title")).toBe("Уже продают с Enveriq");
    expect(homeT("en", "Другое")("compare.one")).toBe("With Другое");
    expect(homeT("ru", BRAND.name)("hero.ctaSignup", { days: 7 })).toBe(
      "Попробовать 7 дней бесплатно",
    );
  });

  it("заголовок страницы с ключевыми словами поиска и именем продукта, не длиннее 80 знаков", () => {
    for (const l of SUPPORTED_LOCALES) {
      const title = homeT(l, BRAND.name)("meta.title");
      expect(title).toContain("Instagram");
      expect(title).toContain("Telegram");
      expect(title).toContain(BRAND.name);
      expect(title.length, l).toBeLessThanOrEqual(80);
    }
  });
});

describe("клиенты на главной", () => {
  it("у каждого клиента описание на всех языках, цифра крупно есть и в подписи", () => {
    for (const c of CLIENTS) {
      for (const l of SUPPORTED_LOCALES) {
        expect(c.note[l], `${c.name} ${l}`).toBeTruthy();
        if (c.stat) expect(c.stat.label[l], `${c.name} ${l}`).toBeTruthy();
      }
    }
  });
});
