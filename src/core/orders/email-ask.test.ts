import { describe, expect, it } from "vitest";
import { EMAIL_ASK_DEFAULT_OFF, emailAskOn } from "./email-ask";

describe("почта после чека", () => {
  it("выбор продавца решает; без него Копилка не спрашивает, остальные спрашивают", () => {
    const kopilka = EMAIL_ASK_DEFAULT_OFF[0]!;
    expect(emailAskOn(null, kopilka)).toBe(false);
    expect(emailAskOn("true", kopilka)).toBe(true);
    expect(emailAskOn(null, "other")).toBe(true);
    expect(emailAskOn("false", "other")).toBe(false);
  });
});
