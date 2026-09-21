import { describe, expect, it } from "vitest";
import { isFulfillmentReminderEligible, parseReminderHours, shouldSendCartReminder } from "./pure";

const H = 60 * 60 * 1000;
const now = new Date("2026-09-20T12:00:00Z");

describe("shouldSendCartReminder", () => {
  it("ждёт порог и не повторяет напоминание для той же корзины", () => {
    expect(shouldSendCartReminder(new Date(now.getTime() - 5 * H), now, 6, null)).toBe(false);
    expect(shouldSendCartReminder(new Date(now.getTime() - 7 * H), now, 6, null)).toBe(true);
    const activity = new Date(now.getTime() - 7 * H);
    expect(shouldSendCartReminder(activity, now, 6, new Date(activity.getTime() + H))).toBe(false);
    expect(shouldSendCartReminder(activity, now, 6, new Date(activity.getTime() - H))).toBe(true);
  });
  it("0 часов — модуль выключен", () => {
    expect(shouldSendCartReminder(new Date(0), now, 0, null)).toBe(false);
  });
});

describe("isFulfillmentReminderEligible", () => {
  it("окно — ближайшие 24 часа, только будущее и только один раз", () => {
    expect(isFulfillmentReminderEligible(new Date(now.getTime() + 2 * H), now, null)).toBe(true);
    expect(isFulfillmentReminderEligible(new Date(now.getTime() + 30 * H), now, null)).toBe(false);
    expect(isFulfillmentReminderEligible(new Date(now.getTime() - H), now, null)).toBe(false);
    expect(isFulfillmentReminderEligible(new Date(now.getTime() + 2 * H), now, now)).toBe(false);
  });
});

describe("parseReminderHours", () => {
  it("пусто → 6, число → число, мусор → 6, 0 → 0", () => {
    expect(parseReminderHours(null)).toBe(6);
    expect(parseReminderHours("")).toBe(6);
    expect(parseReminderHours("12")).toBe(12);
    expect(parseReminderHours("abc")).toBe(6);
    expect(parseReminderHours("0")).toBe(0);
    expect(parseReminderHours("-3")).toBe(6);
  });
});
