import { describe, expect, it } from "vitest";
import { COPY } from "@/channels/telegram/copy";
import { BOT_TEXT_VARS, DIRECT_KEYS, MSG_PROPS } from "@/core/bot-texts/registry";
import { directCopy } from "./copy";

const tenant = (bot_texts?: Record<string, unknown>) => ({ settings: { bot_texts } }) as never;

describe("словарь Direct со своими текстами продавца", () => {
  it("без своих текстов — стандартный словарь", () => {
    expect(directCopy(tenant(), "instagram", "ru")).toBe(COPY.ru);
  });

  it("строка «В ответ отправьте только цифру» в вопросах о стране и языке (AATeach, 11.10)", () => {
    const own = "🌐 На каком языке нужны материалы?\n👇 В ответ отправьте только цифру.";
    const m = directCopy(
      tenant({
        language_ask: { instagram: { ru: own } },
        country_ask: { instagram: { ru: "Откуда платите?\n👇 Только цифру." } },
      }),
      "instagram",
      "ru",
    );
    expect(m.chooseDeliveryLanguage).toBe(own);
    // Обе формы вопроса о стране: со суммами по странам и без.
    expect(m.choosePayCountry).toBe("Откуда платите?\n👇 Только цифру.");
    expect(m.chooseCountry).toBe("Откуда платите?\n👇 Только цифру.");
    expect(m.emailAsk).toBe(COPY.ru.emailAsk);
  });

  it("фраза-функция получает {order} и {email} по порядку; HTML экранируется", () => {
    const m = directCopy(
      tenant({ receipt_received_email: { instagram: { ru: "№{order} → {email} <b>&" } } }),
      "instagram",
      "ru",
    );
    expect(m.proofReceivedEmail(12, "a@b.kz")).toBe("№12 → a@b.kz &lt;b&gt;&amp;");
  });

  it("действует только язык и канал, для которых задан: WhatsApp и kk — стандартные", () => {
    const t = tenant({ email_ask: { instagram: { ru: "Почта?" }, whatsapp: { ru: "WA?" } } });
    expect(directCopy(t, "instagram", "kk").emailAsk).toBe(COPY.kk.emailAsk);
    expect(directCopy(t, "whatsapp", "ru").emailAsk).toBe(COPY.ru.emailAsk);
  });

  it("каждый ключ Direct заменяет существующую фразу; у функции столько аргументов, сколько подстановок", () => {
    for (const key of DIRECT_KEYS)
      for (const prop of MSG_PROPS[key] ?? []) {
        const std = (COPY.ru as Record<string, unknown>)[prop];
        expect(std, `${key} → ${prop}`).toBeDefined();
        if (typeof std === "function")
          expect(std.length, `${key} → ${prop}`).toBe(BOT_TEXT_VARS[key].length);
        else expect(BOT_TEXT_VARS[key], key).toEqual([]);
      }
  });
});
