import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import {
  BOT_TEXT_KEYS,
  BOT_TEXT_MAX,
  BOT_TEXT_VARS,
  DIRECT_KEYS,
  MSG_PROPS,
  STANDARD,
  WIRED,
  cleanBotText,
  cleanWorkHours,
  customFilled,
  customText,
  fillText,
  outsideWorkHours,
  sampleVars,
  unknownVars,
} from "./registry";

const tenant = (settings: Record<string, unknown>) => ({ settings }) as never;

describe("стандартные тексты на четырёх языках", () => {
  it("у «вне часов» и «спасибо за заказ» есть ru, kk, en, uz, и они разные", () => {
    for (const key of ["off_hours", "order_thanks"] as const) {
      const words = SUPPORTED_LOCALES.map((l) => STANDARD[key]![l]);
      expect(words.every((w) => w.length > 10)).toBe(true);
      expect(new Set(words).size).toBe(4);
    }
  });

  it("подстановки в стандартных текстах — из списка своего ключа", () => {
    for (const key of ["off_hours", "order_thanks"] as const)
      for (const l of SUPPORTED_LOCALES)
        expect(unknownVars(key, STANDARD[key]![l]), `${key}/${l}`).toEqual([]);
  });

  it("каждый ключ описан и подключён хотя бы к одному каналу", () => {
    expect([...WIRED.telegram]).toEqual(["welcome", "off_hours", "order_thanks", "not_understood"]);
    for (const key of BOT_TEXT_KEYS) {
      expect(BOT_TEXT_VARS[key]).toBeDefined();
      expect(WIRED.telegram.includes(key) || WIRED.instagram.includes(key), key).toBe(true);
    }
  });

  it("Instagram — шаги покупки в Direct, у каждого есть фраза словаря; WhatsApp пока не подключён", () => {
    expect([...WIRED.instagram]).toEqual([...DIRECT_KEYS]);
    for (const key of DIRECT_KEYS) expect(MSG_PROPS[key]?.length, key).toBeGreaterThan(0);
    expect(WIRED.whatsapp).toEqual([]);
  });
});

describe("свой текст", () => {
  it("подстановки заменяются, незнакомые остаются", () => {
    expect(fillText("Спасибо, {shop}! №{order} {zzz}", { shop: "Лавка", order: "7" })).toBe(
      "Спасибо, Лавка! №7 {zzz}",
    );
    expect(unknownVars("welcome", "{shop} {shpo} {order}")).toEqual(["shpo", "order"]);
  });

  it("берётся по ключу, каналу и языку; пустой и чужой язык — стандартный (null)", () => {
    const t = tenant({ bot_texts: { welcome: { telegram: { ru: "Привет, {shop}", kk: "  " } } } });
    expect(customFilled(t, "welcome", "telegram", "ru", { shop: "Лавка" })).toBe("Привет, Лавка");
    expect(customText(t, "welcome", "telegram", "kk")).toBeNull();
    expect(customText(t, "welcome", "telegram", "en")).toBeNull();
    expect(customText(t, "welcome", "instagram", "ru")).toBeNull();
    expect(customText(t, "off_hours", "telegram", "ru")).toBeNull();
  });

  it("очистка: пробелы по краям, управляющие символы, предел длины; пусто — null (сброс)", () => {
    expect(cleanBotText("  привет\u0007\r\nмир  ")).toBe("привет\nмир");
    expect(cleanBotText("   ")).toBeNull();
    expect(cleanBotText(null)).toBeNull();
    expect(cleanBotText("я".repeat(BOT_TEXT_MAX + 50))).toHaveLength(BOT_TEXT_MAX);
  });
});

describe("рабочие часы", () => {
  it("целые 0–24, начало и конец разные; иначе часов нет", () => {
    expect(cleanWorkHours({ open: 9, close: 18 })).toEqual({ open: 9, close: 18 });
    expect(cleanWorkHours({ open: 9, close: 9 })).toBeNull();
    expect(cleanWorkHours({ open: 9.5, close: 18 })).toBeNull();
    expect(cleanWorkHours({ open: 9, close: 25 })).toBeNull();
    expect(cleanWorkHours(null)).toBeNull();
  });

  it("вне часов — по поясу магазина; без часов никогда", () => {
    const t = tenant({ work_hours: { open: 10, close: 21 } });
    // 14:05 по Алматы (UTC+5) — внутри, 02:00 — вне
    expect(outsideWorkHours(t, new Date("2026-10-04T09:05:00Z"), "Asia/Almaty")).toBe(false);
    expect(outsideWorkHours(t, new Date("2026-10-03T21:00:00Z"), "Asia/Almaty")).toBe(true);
    expect(outsideWorkHours(tenant({}), new Date("2026-10-03T21:00:00Z"), "Asia/Almaty")).toBe(
      false,
    );
  });

  it("образцы для предпросмотра берут часы магазина", () => {
    expect(sampleVars("Лавка", { open: 9, close: 18 })).toMatchObject({
      shop: "Лавка",
      from: "09:00",
      to: "18:00",
    });
  });
});

describe("чтение арендатора: тексты и часы доходят до настроек", () => {
  it("settingsFromJson не теряет bot_texts и work_hours (иначе бот их не увидит)", async () => {
    const { settingsFromJson } = await import("@/core/tenant/directory");
    const s = settingsFromJson({
      bot_texts: {
        welcome: { telegram: { ru: " Привет ", xx: "лишний язык" }, fax: { ru: "лишний канал" } },
        unknown_key: { telegram: { ru: "лишний ключ" } },
        not_understood: null,
      },
      work_hours: { open: 9, close: 18 },
    });
    expect(s.bot_texts).toEqual({ welcome: { telegram: { ru: "Привет" } } });
    expect(s.work_hours).toEqual({ open: 9, close: 18 });
    expect(settingsFromJson({}).bot_texts).toBeUndefined();
    expect(settingsFromJson({ work_hours: { open: 5, close: 5 } }).work_hours).toBeUndefined();
  });
});
