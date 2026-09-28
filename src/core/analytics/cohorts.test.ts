import { describe, expect, it } from "vitest";
import { cohortTable, monthOf, repeatStats } from "./cohorts";

const TZ = "Asia/Almaty";

describe("когорты покупателей", () => {
  it("месяц — в поясе магазина: 31-е 20:00 UTC в Алматы уже следующий месяц", () => {
    expect(monthOf("2026-08-31T20:00:00Z", TZ)).toBe("2026-09");
  });

  it("когорта по первой покупке, доля вернувшихся по месяцам до текущего", () => {
    const rows = cohortTable(
      [
        { buyer: "a", at: "2026-07-05T10:00:00Z" },
        { buyer: "a", at: "2026-08-05T10:00:00Z" },
        { buyer: "b", at: "2026-07-10T10:00:00Z" },
        { buyer: "b", at: "2026-09-10T10:00:00Z" },
        { buyer: "c", at: "2026-09-01T10:00:00Z" },
      ],
      TZ,
      { now: new Date("2026-09-28T10:00:00Z") },
    );
    expect(rows).toEqual([
      { month: "2026-09", size: 1, retention: [] },
      { month: "2026-07", size: 2, retention: [50, 50] },
    ]);
  });

  it("старые когорты за окном отбрасываются", () => {
    const rows = cohortTable([{ buyer: "a", at: "2025-01-05T10:00:00Z" }], TZ, {
      now: new Date("2026-09-28T10:00:00Z"),
    });
    expect(rows).toEqual([]);
  });

  it("повторные покупки: купившие больше одного раза", () => {
    expect(repeatStats([{ buyer: "a" }, { buyer: "a" }, { buyer: "b" }])).toEqual({
      buyers: 2,
      repeat: 1,
      rate: 50,
    });
    expect(repeatStats([])).toEqual({ buyers: 0, repeat: 0, rate: 0 });
  });
});
