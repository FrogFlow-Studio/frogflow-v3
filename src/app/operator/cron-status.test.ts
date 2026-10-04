import { describe, expect, it } from "vitest";
import { BUDGET_STREAK_WARN } from "./cron-status.shared";
import { CRON_JOBS, cronStale, nextBudgetStreak, summarizeResults } from "./cron-status.server";

describe("состояние кронов", () => {
  it("молчит без запусков и после двух интервалов, живёт внутри", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    expect(cronStale(15, null, now)).toBe(true);
    expect(cronStale(15, "2026-09-26T09:40:00Z", now)).toBe(false);
    expect(cronStale(15, "2026-09-26T09:20:00Z", now)).toBe(true);
    expect(cronStale(1440, "2026-09-25T04:00:00Z", now)).toBe(false);
  });
  it("сводка обрезает длинные значения и не тянет всё подряд", () => {
    const s = summarizeResults({ a: { x: 1 }, b: "y".repeat(400) });
    expect(s).toContain('a: {"x":1}');
    expect(s).toContain("…");
    expect(s.length).toBeLessThan(400);
  });
  it("все задачи из vercel.json есть в списке", () => {
    expect(CRON_JOBS.map((j) => j.job)).toContain("retention");
    expect(CRON_JOBS).toHaveLength(11);
  });
});

describe("бюджет крона", () => {
  const run = (resume: string | null, budgetStreak?: number) => ({
    at: "2026-10-03T10:00:00Z",
    ok: true,
    durationMs: 1,
    tenants: 1,
    summary: "",
    error: null,
    resume,
    budgetStreak,
  });
  it("серия растёт, пока остаётся resume, и обнуляется, когда уложились", () => {
    expect(nextBudgetStreak(null, { resume: "bot-b" })).toBe(1);
    expect(nextBudgetStreak(run("bot-b", 2), { resume: "bot-c" })).toBe(3);
    expect(nextBudgetStreak(run("bot-b", 2), { resume: null })).toBe(0);
  });
  it("предупреждение с третьего запуска подряд", () => {
    let prev: ReturnType<typeof run> | null = null;
    const streaks: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = nextBudgetStreak(prev, { resume: "x" });
      streaks.push(s);
      prev = run("x", s);
    }
    expect(streaks).toEqual([1, 2, 3]);
    expect(streaks[2]! >= BUDGET_STREAK_WARN).toBe(true);
    expect(streaks[1]! >= BUDGET_STREAK_WARN).toBe(false);
  });
});
