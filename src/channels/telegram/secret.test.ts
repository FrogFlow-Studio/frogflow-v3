import { describe, expect, it } from "vitest";
import { telegramWebhookSecret, telegramWebhookUrl, verifyTelegramWebhookHeader } from "./secret";

const BOT = "0bac1f86-5231-4e57-838d-2faa44d427e7";

describe("telegram webhook secret", () => {
  it("детерминирован по bot_id и укладывается в ограничения Telegram", () => {
    const s = telegramWebhookSecret(BOT, "platform");
    expect(s).toBe(telegramWebhookSecret(BOT, "platform"));
    expect(s).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    expect(s).not.toBe(telegramWebhookSecret("de44b934-c8db-47ac-9aa9-535c762cf8c7", "platform"));
    expect(s).not.toBe(telegramWebhookSecret(BOT, "other"));
  });

  it("проверяет заголовок, отвергает пустой и чужой", () => {
    const s = telegramWebhookSecret(BOT, "platform");
    expect(verifyTelegramWebhookHeader(s, BOT, "platform")).toBe(true);
    expect(verifyTelegramWebhookHeader(null, BOT, "platform")).toBe(false);
    expect(verifyTelegramWebhookHeader(s + "x", BOT, "platform")).toBe(false);
  });

  it("строит адрес вебхука без двойного слэша", () => {
    expect(telegramWebhookUrl("https://app.test/", BOT)).toBe(
      `https://app.test/api/telegram/${BOT}`,
    );
  });
});
