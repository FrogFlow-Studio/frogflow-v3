import { describe, expect, it } from "vitest";
import {
  addDaysToIso,
  amountDue,
  isoToDisplay,
  matchFulfillmentType,
  parseDateInput,
  todayInTz,
} from "./pure";

describe("fulfillment pure", () => {
  it("дата: разбор, отображение, сдвиг", () => {
    expect(parseDateInput("05.03.2026")).toBe("2026-03-05");
    expect(parseDateInput("5/3/2026")).toBe("2026-03-05");
    expect(parseDateInput("31.02.2026")).toBeNull();
    expect(parseDateInput("завтра")).toBeNull();
    expect(isoToDisplay("2026-03-05")).toBe("05.03.2026");
    expect(addDaysToIso("2026-02-27", 3)).toBe("2026-03-02");
    expect(todayInTz("Asia/Almaty", new Date("2026-03-05T20:30:00Z"))).toBe("2026-03-06");
  });

  it("задаток: полная, процент, при получении", () => {
    expect(amountDue(10000, "full", 30)).toBe(10000);
    expect(amountDue(10000, "deposit", 30)).toBe(3000);
    expect(amountDue(10000, "deposit", 0)).toBe(3000);
    expect(amountDue(10000, "on_receipt", 30)).toBe(0);
  });

  it("тип получения из текста", () => {
    expect(matchFulfillmentType("Самовывоз")).toBe("pickup");
    expect(matchFulfillmentType("нужна доставка")).toBe("delivery");
    expect(matchFulfillmentType("не знаю")).toBeNull();
  });
});
