import { describe, expect, it } from "vitest";
import {
  addMark,
  dropMark,
  dueRenewalStage,
  marksFor,
  renewalPrice,
  renewalSummary,
  type RenewalRow,
} from "./renewals";

describe("воронка продлений: какое напоминание пора", () => {
  it("7, 3, 1 день и день окончания; раньше, позже и просрочка — тихо", () => {
    const at = (n: number) => dueRenewalStage(n, []);
    expect([10, 8].map(at)).toEqual([null, null]);
    expect([7, 6, 5, 4].map(at)).toEqual(["d7", "d7", "d7", "d7"]);
    expect([3, 2].map(at)).toEqual(["d3", "d3"]);
    expect(at(1)).toBe("d1");
    expect(at(0)).toBe("d0");
    expect(at(-1)).toBeNull();
  });
  it("уже отправленная стадия не повторяется", () => {
    expect(dueRenewalStage(7, ["d7"])).toBeNull();
    expect(dueRenewalStage(2, ["d7"])).toBe("d3");
  });
});

describe("отметки", () => {
  it("метки прошлого срока не считаются: оплатил — серия начинается заново", () => {
    const raw = addMark(null, "2026-10-08", "d7")!;
    expect(raw).toBe("2026-10-08:d7");
    expect(marksFor(raw, "2026-11-07")).toEqual([]);
    expect(addMark(raw, "2026-10-08", "d7")).toBeNull();
    expect(addMark(raw, "2026-11-07", "d7")).toBe("2026-11-07:d7");
  });
  it("снимается только поставленная", () => {
    expect(dropMark("2026-10-08:d7,d3", "2026-10-08", "d3")).toBe("2026-10-08:d7");
    expect(dropMark("2026-10-08:d7", "2026-10-08", "d3")).toBeNull();
  });
});

describe("цена продления", () => {
  it("план × период без подключения; без плана — null", () => {
    const t = (plan: string | null, billing: Record<string, unknown> = {}) =>
      ({ plan, settings: { billing } }) as never;
    expect(renewalPrice(t("digital.basic"))).toEqual({ amount: 9_900, period: "month" });
    expect(renewalPrice(t("digital.pro", { period: "year" }))).toEqual({
      amount: 199_000,
      period: "year",
    });
    expect(renewalPrice(t("digital.basic", { monthly_price: 4_950 }))).toEqual({
      amount: 4_950,
      period: "month",
    });
    expect(renewalPrice(t(null))).toBeNull();
  });
});

describe("список оператора", () => {
  const row = (botId: string, daysLeft: number, amount: number | null): RenewalRow => ({
    botId,
    name: botId,
    servedBy: "v2",
    expires: "2026-10-20",
    daysLeft,
    amount,
  });
  it("в окне 14 дней по возрастанию срока, сумма без клиентов без плана, просрочка отдельно", () => {
    const s = renewalSummary(
      [
        row("a", 10, 9_900),
        row("b", 2, 19_900),
        row("c", 14, null),
        row("d", 15, 9_900),
        row("e", -3, 9_900),
      ],
      14,
    );
    expect(s.list.map((r) => r.botId)).toEqual(["b", "a", "c"]);
    expect(s.expected).toBe(29_800);
    expect(s.noPrice).toBe(1);
    expect(s.overdue).toBe(1);
  });
});
