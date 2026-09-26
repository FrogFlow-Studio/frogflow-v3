import { describe, expect, it } from "vitest";
import { CRON_JOBS, cronStale, summarizeResults } from "./cron-status.server";

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
    expect(CRON_JOBS).toHaveLength(9);
  });
});
