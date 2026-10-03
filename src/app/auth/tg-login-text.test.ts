import { describe, expect, it } from "vitest";
import { tgLoginMessage } from "./tg-login-text";

describe("сообщение «Войти через Telegram»", () => {
  const link = "https://x.test/admin/tg-login?b=1&t=2";
  it("на языке магазина, со ссылкой и сроком", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const text = tgLoginMessage(l, link);
      expect(text).toContain(link);
      expect(text).toContain("10");
    }
    expect(tgLoginMessage("en", link)).not.toMatch(/[а-яё]/i);
    expect(tgLoginMessage("uz", link)).not.toMatch(/[а-яё]/i);
    expect(tgLoginMessage("kk", link)).not.toBe(tgLoginMessage("ru", link));
  });
  it("русский текст прежний", () => {
    expect(tgLoginMessage("ru", link)).toContain("Если входите не вы — не открывайте её.");
  });
});
