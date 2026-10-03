import { describe, expect, it } from "vitest";
import {
  decideDelivery,
  defaultNotifyPrefs,
  inQuietHours,
  parseNotifyPrefs,
  urgentWithoutTelegram,
} from "./prefs";

const TZ = "Asia/Almaty"; // UTC+5
const at = (hhmmUtc: string) => new Date(`2026-09-26T${hhmmUtc}:00Z`);

describe("настройки уведомлений продавца", () => {
  it("по умолчанию всё в Telegram, почта выключена, тихих часов нет", () => {
    const p = parseNotifyPrefs(null);
    expect(p.kinds.new_order).toEqual({ telegram: true, email: false });
    expect(p.quiet).toBeNull();
    expect(p.digest).toEqual({ enabled: false, hour: 9 });
  });
  it("читает сохранённое и отбрасывает мусор", () => {
    const p = parseNotifyPrefs(
      JSON.stringify({
        kinds: { question: { telegram: false, email: true }, bogus: { telegram: false } },
        email: " a@b.kz ",
        quiet: { from: "22:00", to: "8:00" },
        digest: { enabled: true, hour: 27 },
      }),
    );
    expect(p.kinds.question).toEqual({ telegram: false, email: true });
    expect(p.email).toBe("a@b.kz");
    expect(p.quiet).toBeNull();
    expect(p.digest).toEqual({ enabled: true, hour: 9 });
    expect(parseNotifyPrefs("{oops").kinds.system.telegram).toBe(true);
  });
  it("тихие часы через полночь в поясе магазина", () => {
    const p = { ...defaultNotifyPrefs(), quiet: { from: "22:00", to: "08:00" } };
    expect(inQuietHours(p, at("18:00"), TZ)).toBe(true); // 23:00 в Алматы
    expect(inQuietHours(p, at("02:30"), TZ)).toBe(true); // 07:30
    expect(inQuietHours(p, at("05:00"), TZ)).toBe(false); // 10:00
  });
  it("срочное идёт ночью, остальное — в дайджест; выключенный канал молчит", () => {
    const p = { ...defaultNotifyPrefs(), quiet: { from: "22:00", to: "08:00" }, email: "a@b.kz" };
    p.kinds.question = { telegram: true, email: true };
    p.kinds.system = { telegram: false, email: false };
    expect(decideDelivery(p, "new_order", at("18:00"), TZ)).toEqual({
      telegram: true,
      email: false,
      defer: false,
    });
    expect(decideDelivery(p, "question", at("18:00"), TZ)).toEqual({
      telegram: false,
      email: false,
      defer: true,
    });
    expect(decideDelivery(p, "question", at("06:00"), TZ)).toEqual({
      telegram: true,
      email: true,
      defer: false,
    });
    expect(decideDelivery(p, "system", at("06:00"), TZ)).toEqual({
      telegram: false,
      email: false,
      defer: false,
    });
  });
  describe("почта платформы не настроена (SMTP)", () => {
    const base = () => {
      const p = { ...defaultNotifyPrefs(), email: "a@b.kz" };
      return p;
    };
    it("срочное «только почта» без SMTP уходит в Telegram, а не теряется", () => {
      const p = base();
      p.kinds.new_order = { telegram: false, email: true };
      expect(decideDelivery(p, "new_order", at("18:00"), TZ, false)).toEqual({
        telegram: true,
        email: false,
        defer: false,
      });
    });
    it("срочное остаётся в Telegram, даже если сохранено без него", () => {
      const p = base();
      p.kinds.complaint = { telegram: false, email: true };
      expect(decideDelivery(p, "complaint", at("18:00"), TZ, true)).toEqual({
        telegram: true,
        email: true,
        defer: false,
      });
    });
    it("несрочное «только почта» без SMTP тоже падает в Telegram", () => {
      const p = base();
      p.kinds.question = { telegram: false, email: true };
      expect(decideDelivery(p, "question", at("06:00"), TZ, false)).toEqual({
        telegram: true,
        email: false,
        defer: false,
      });
    });
    it("выключенное остаётся выключенным", () => {
      const p = base();
      p.kinds.system = { telegram: false, email: false };
      expect(decideDelivery(p, "system", at("06:00"), TZ, false).telegram).toBe(false);
    });
    it("urgentWithoutTelegram находит срочные виды без Telegram", () => {
      const p = base();
      p.kinds.new_order = { telegram: false, email: true };
      p.kinds.question = { telegram: false, email: true };
      expect(urgentWithoutTelegram(p.kinds)).toEqual(["new_order"]);
    });
  });
});
