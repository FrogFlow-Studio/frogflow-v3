import { describe, expect, it } from "vitest";
import { deletionConfirmed, deletionDaysLeft, deletionDue } from "./deletion";

const at = "2026-09-01T10:00:00.000Z";
const day = 86400_000;

describe("удаление магазина с холдом", () => {
  it("холд 30 дней: раньше — не пора, ровно через 30 — пора", () => {
    expect(deletionDue(undefined)).toBe(false);
    expect(deletionDue({ requested_at: at }, Date.parse(at) + 30 * day - 1)).toBe(false);
    expect(deletionDue({ requested_at: at }, Date.parse(at) + 30 * day)).toBe(true);
  });

  it("осталось дней — с округлением вверх, не меньше нуля", () => {
    expect(deletionDaysLeft(at, Date.parse(at))).toBe(30);
    expect(deletionDaysLeft(at, Date.parse(at) + 29.5 * day)).toBe(1);
    expect(deletionDaysLeft(at, Date.parse(at) + 40 * day)).toBe(0);
  });

  it("подтверждение — название магазина без учёта регистра и лишних пробелов", () => {
    expect(deletionConfirmed("  торты  анны ", "Торты Анны")).toBe(true);
    expect(deletionConfirmed("Торты", "Торты Анны")).toBe(false);
    expect(deletionConfirmed("", "")).toBe(false);
  });
});
