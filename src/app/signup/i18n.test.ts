import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  SIGNUP_CLOSED,
  SIGNUP_UNAVAILABLE,
  SIGNUP_USERNAME_RULE,
  addressTakenText,
  idTakenText,
  loginTakenText,
} from "./refusals";
import { CHALLENGE_TOO_FAST, REFRESH } from "./challenge";
import { SIGNUP_DICTS, signupErrorText, signupT } from "./i18n";
import { signupVerdict } from "./signup.server";

describe("регистрация на 4 языках", () => {
  it("каждый ключ есть на всех языках", () => {
    const ru = Object.keys(SIGNUP_DICTS.ru);
    for (const l of SUPPORTED_LOCALES) {
      const d = SIGNUP_DICTS[l] as Record<string, string>;
      expect(
        ru.filter((k) => !d[k]),
        l,
      ).toEqual([]);
    }
  });
  it("ошибки сервера переводятся по русскому тексту", () => {
    const refusals = [
      REFRESH,
      CHALLENGE_TOO_FAST,
      signupVerdict({ ip: 99, total: 0 })!,
      signupVerdict({ ip: 0, total: 99 })!,
      SIGNUP_CLOSED,
      SIGNUP_UNAVAILABLE,
      SIGNUP_USERNAME_RULE,
      idTakenText("myshop"),
      loginTakenText("myshop"),
      addressTakenText("myshop"),
    ];
    for (const r of refusals) {
      expect(signupErrorText("ru", new Error(r))).toBe(r);
      for (const l of ["kk", "en", "uz"] as const) {
        const text = signupErrorText(l, new Error(r));
        expect(text, `${l}: ${r}`).not.toBe(r);
      }
    }
  });
  it("подставляет адрес и логин в перевод", () => {
    expect(signupErrorText("en", new Error(idTakenText("myshop")))).toContain("myshop");
    expect(signupErrorText("kk", new Error(addressTakenText("my.shop")))).toContain("my.shop");
    expect(signupErrorText("uz", new Error(loginTakenText("a_b")))).toContain("a_b");
  });
  it("ошибка проверки логина целиком, с заголовком «Логин»", () => {
    const zod = new Error(`[{"message":"${SIGNUP_USERNAME_RULE}"}]`);
    expect(signupErrorText("en", zod)).toBe("Login: Latin letters, digits, dot, hyphen");
  });
  it("незнакомая ошибка остаётся как есть", () => {
    expect(signupErrorText("kk", new Error("boom"))).toBe("boom");
  });
  it("подпись формы на казахском не русская", () => {
    expect(signupT("kk")("form.name")).not.toBe(signupT("ru")("form.name"));
  });
});
