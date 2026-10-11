import { describe, expect, it } from "vitest";
import {
  EMAIL_ASK_DEFAULT_OFF,
  emailAskOn,
  emailOptionalOn,
  looksLikeEmailAttempt,
  mentionsEmail,
  wantsFilesHere,
} from "./email-ask";

describe("почта после чека", () => {
  it("выбор продавца решает; без него Копилка не спрашивает, остальные спрашивают", () => {
    const kopilka = EMAIL_ASK_DEFAULT_OFF[0]!;
    expect(emailAskOn(null, kopilka)).toBe(false);
    expect(emailAskOn("true", kopilka)).toBe(true);
    expect(emailAskOn(null, "other")).toBe(true);
    expect(emailAskOn("false", "other")).toBe(false);
  });
});

describe("почта по желанию", () => {
  it("«вацап», «сюда», «в инстаграм», «не надо» — файлы сюда", () => {
    for (const t of [
      "Вацап отправте",
      "Можете сбросить на вацап, не умею распечатать с телефона",
      "А в инстаграм можно отправить?",
      "сюда",
      "не надо почту",
    ])
      expect(wantsFilesHere(t), t).toBe(true);
    expect(wantsFilesHere("Спасибо")).toBe(false);
  });

  it("просьба о почте отличается от просьбы прислать материал", () => {
    expect(mentionsEmail("отправьте на почту")).toBe(true);
    expect(mentionsEmail("Отправьте материал, который оплатила")).toBe(false);
  });

  it("адрес с опечаткой узнаётся, обычная фраза — нет", () => {
    expect(looksLikeEmailAttempt("anna mail.ru")).toBe(true);
    expect(looksLikeEmailAttempt("annagmail.com")).toBe(true);
    expect(looksLikeEmailAttempt("Вацап отправте")).toBe(false);
    expect(looksLikeEmailAttempt("А на почту отправите материалы?")).toBe(false);
  });

  it("включено по умолчанию", () => {
    expect(emailOptionalOn(undefined)).toBe(true);
    expect(emailOptionalOn("false")).toBe(false);
  });
});
