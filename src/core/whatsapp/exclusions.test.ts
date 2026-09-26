import { describe, expect, it } from "vitest";
import { excludedPhoneSet, isExcludedSender } from "./exclusions";

describe("исключённые номера WhatsApp", () => {
  it("+7 и 8 — один номер; короткие и пустые записи не считаются", () => {
    const set = excludedPhoneSet("8 (701) 123-45-67, +77012223344; мусор\n12345");
    expect(isExcludedSender(set, "77011234567")).toBe(true);
    expect(isExcludedSender(set, null, "+7 701 222 33 44")).toBe(true);
    expect(isExcludedSender(set, "77019999999")).toBe(false);
    expect(isExcludedSender(new Set(), "77011234567")).toBe(false);
  });
});
