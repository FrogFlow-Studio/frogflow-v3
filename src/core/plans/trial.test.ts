import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, readPolicy } from "@/core/billing/subscription";
import { afterTrial, daysBetween, dueStage, trialState } from "./trial";
import { todayInTz } from "@/core/fulfillment/pure";

describe("пробный период: сколько осталось", () => {
  const billing = { trial_until: "2026-10-09" };
  it("считает дни до последнего дня включительно", () => {
    expect(trialState(billing, "2026-10-09T00:00:00Z", "2026-10-06")).toEqual({
      until: "2026-10-09",
      daysLeft: 3,
    });
    expect(trialState(billing, null, "2026-10-09")?.daysLeft).toBe(0);
  });
  it("закончился или не заводился — null", () => {
    expect(trialState(billing, null, "2026-10-10")).toBeNull();
    expect(trialState({}, null, "2026-10-01")).toBeNull();
    expect(trialState(undefined, null, "2026-10-01")).toBeNull();
  });
  it("оплата продлила подписку дальше пробного — пробный позади", () => {
    expect(trialState(billing, "2026-11-08T00:00:00Z", "2026-10-06")).toBeNull();
    expect(trialState(billing, "2026-10-09T23:59:00Z", "2026-10-06")).not.toBeNull();
  });
  it("день считается по часовому поясу магазина, не по UTC", () => {
    // 02:00 UTC 10 октября — в Алматы (UTC+5) уже 10-е, в Нью-Йорке ещё 9-е.
    const now = new Date("2026-10-10T02:00:00Z");
    expect(trialState(billing, null, todayInTz("Asia/Almaty", now))).toBeNull();
    expect(trialState(billing, null, todayInTz("America/New_York", now))?.daysLeft).toBe(0);
  });
  it("разница дат через границу месяца", () => {
    expect(daysBetween("2026-09-29", "2026-10-02")).toBe(3);
  });
});

describe("пробный период: какое напоминание пора", () => {
  it("за 3 дня и в последний день, каждое один раз", () => {
    expect(dueStage(3, [])).toBe("d3");
    expect(dueStage(3, ["d3"])).toBeNull();
    expect(dueStage(0, ["d3"])).toBe("last");
    expect(dueStage(0, ["d3", "last"])).toBeNull();
  });
  it("крон пропустил сутки — напоминание за 3 дня уходит за 2 или 1 день", () => {
    expect(dueStage(2, [])).toBe("d3");
    expect(dueStage(1, [])).toBe("d3");
  });
  it("раньше 3 дней и после конца — ничего", () => {
    expect(dueStage(4, [])).toBeNull();
    expect(dueStage(-1, [])).toBeNull();
  });
});

describe("пробный период: что будет после", () => {
  it("повторяет политику обхода подписок", () => {
    expect(afterTrial(DEFAULT_POLICY)).toEqual({ mode: "warn", graceDays: 3 });
    expect(afterTrial(readPolicy({ on_overdue: "suspend", grace_days: 5 }))).toEqual({
      mode: "suspend",
      graceDays: 5,
    });
  });
});
