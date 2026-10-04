import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  closedRules,
  describeClosed,
  earliestOpenDate,
  isClosedDay,
  isoWeekday,
  nextOpenDay,
  parseClosedDates,
  parseClosedRules,
  parseClosedWeekdays,
  prepareClosedDates,
  MAX_CLOSED_ENTRIES,
  serializeClosedDates,
  unparsedClosedDates,
} from "./closed-days";
import { checkFulfillmentDate } from "./fulfillment";

// 2026-10-09 — пятница, 10-10 — суббота, 10-11 — воскресенье, 10-12 — понедельник.
const WEEKEND = parseClosedRules("6,7", "");

describe("нерабочие дни выдачи", () => {
  it("день недели ISO: понедельник — 1, воскресенье — 7", () => {
    expect(isoWeekday("2026-10-12")).toBe(1);
    expect(isoWeekday("2026-10-11")).toBe(7);
  });

  it("дни недели: мусор и повторы отброшены, все семь — не правило", () => {
    expect(parseClosedWeekdays("7, 6;7 x 0 8 1.5")).toEqual([6, 7]);
    expect(parseClosedWeekdays("1,2,3,4,5,6,7")).toEqual([]);
    expect(parseClosedWeekdays(null)).toEqual([]);
  });

  it("даты и отрезки: ДД.ММ.ГГГГ и ISO, конец раньше начала и несуществующая дата отброшены", () => {
    const r = parseClosedDates(
      "31.12.2026\n2027-01-03..2027-01-01, 30.12.2026–02.01.2027; 31.02.2026; 2026-12-31",
    );
    expect(r).toEqual([
      { from: "2026-12-30", to: "2027-01-02" },
      { from: "2026-12-31", to: "2026-12-31" },
    ]);
    expect(serializeClosedDates(r)).toBe("2026-12-30..2027-01-02\n2026-12-31");
    expect(parseClosedDates(serializeClosedDates(r))).toEqual(r);
  });

  it("форма узнаёт о строках, которые не разобрались", () => {
    expect(unparsedClosedDates("31.12.2026\nпраздник\n01.01.2027..x")).toEqual([
      "праздник",
      "01.01.2027..x",
    ]);
    expect(unparsedClosedDates("")).toEqual([]);
  });

  it("день закрыт по дню недели и по отрезку; пусто — открыт всегда", () => {
    const r = parseClosedRules("7", "2026-12-30..2027-01-02");
    expect(isClosedDay("2026-10-11", r)).toBe(true);
    expect(isClosedDay("2026-10-12", r)).toBe(false);
    expect(isClosedDay("2026-12-30", r) && isClosedDay("2027-01-02", r)).toBe(true);
    expect(isClosedDay("2027-01-04", r)).toBe(false);
    expect(isClosedDay("2026-10-11", parseClosedRules("", ""))).toBe(false);
  });

  it("ближайший рабочий день перескакивает отрезок", () => {
    const r = parseClosedRules("", "2026-12-30..2027-01-02");
    expect(nextOpenDay("2026-12-29", r)).toBe("2026-12-29");
    expect(nextOpenDay("2026-12-30", r)).toBe("2027-01-03");
  });

  it("без нерабочих дней самая ранняя дата — сегодня плюс срок, как раньше", () => {
    const none = parseClosedRules("", "");
    expect(earliestOpenDate("2026-10-09", 0, none)).toBe("2026-10-09");
    expect(earliestOpenDate("2026-10-09", 3, none)).toBe("2026-10-12");
  });

  it("срок изготовления считается рабочими днями: пятница + 1 день при выходных сб–вс — понедельник", () => {
    expect(earliestOpenDate("2026-10-09", 1, WEEKEND)).toBe("2026-10-12");
    expect(earliestOpenDate("2026-10-09", 2, WEEKEND)).toBe("2026-10-13");
  });

  it("срок 0, а сегодня выходной — следующий рабочий день", () => {
    expect(earliestOpenDate("2026-10-10", 0, WEEKEND)).toBe("2026-10-12");
  });

  it("проверка даты: рано, нерабочая (с ближайшей рабочей) и можно", () => {
    const min = "2026-10-12";
    expect(checkFulfillmentDate("2026-10-11", min, WEEKEND)).toEqual({
      ok: false,
      reason: "early",
      minDate: min,
    });
    expect(checkFulfillmentDate("2026-10-17", min, WEEKEND)).toEqual({
      ok: false,
      reason: "closed",
      nextDate: "2026-10-19",
    });
    expect(checkFulfillmentDate("2026-10-14", min, WEEKEND)).toEqual({ ok: true });
  });

  it("сводка для покупателя на четырёх языках", () => {
    const r = parseClosedRules("7", "2026-12-31\n2027-01-01..2027-01-03");
    expect(describeClosed(r, "ru")).toBe("вс, 31.12.2026, 01.01.2027–03.01.2027");
    expect(describeClosed(r, "en")).toBe("Sun, 31.12.2026, 01.01.2027–03.01.2027");
    expect(describeClosed(r, "kk")).toContain("жс");
    expect(describeClosed(r, "uz")).toContain("yak");
  });

  it("правила читаются из настроек магазина", async () => {
    const db = fakeDb();
    db.tables.app_settings = [
      { bot_id: "b", key: "fulfillment_closed_weekdays", value: "7" },
      { bot_id: "b", key: "fulfillment_closed_dates", value: "31.12.2026" },
    ];
    const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
    expect(await closedRules(ctx)).toEqual({
      weekdays: [7],
      ranges: [{ from: "2026-12-31", to: "2026-12-31" }],
    });
  });

  it("к записи: прошедшие отрезки уходят, живые остаются, отрезок через сегодня живой", () => {
    const r = prepareClosedDates("01.01.2026\n2026-10-01..2026-10-20\n31.12.2026", "2026-10-09");
    expect(r).toEqual({ ok: true, value: "2026-10-01..2026-10-20\n2026-12-31" });
  });

  it("61-я запись — отказ, а не молчаливая потеря самой новой даты; ровно 60 проходит", () => {
    const day = (i: number) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10);
    const many = (n: number) => Array.from({ length: n }, (_, i) => day(i)).join("\n");
    const ok = prepareClosedDates(many(MAX_CLOSED_ENTRIES), "2026-10-09");
    expect(ok.ok && ok.value.split("\n")).toHaveLength(MAX_CLOSED_ENTRIES);
    expect(prepareClosedDates(many(MAX_CLOSED_ENTRIES + 1), "2026-10-09")).toEqual({
      ok: false,
      count: MAX_CLOSED_ENTRIES + 1,
    });
    // Прошедшие места освобождают: 61 запись, из них одна уже в прошлом.
    const withPast = `2025-01-01\n${many(MAX_CLOSED_ENTRIES)}`;
    expect(prepareClosedDates(withPast, "2026-10-09").ok).toBe(true);
  });
});
