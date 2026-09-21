import { describe, expect, it } from "vitest";
import { computeState, DEFAULT_POLICY, readPolicy, warnText } from "./subscription";

const P = { on_overdue: "suspend" as const, warn_days_before: 5, grace_days: 3 };
const at = (s: string) => new Date(s);

describe("computeState", () => {
  it("без даты — no_data, а не «просрочено»", () => {
    expect(computeState(null, P, at("2026-09-21T10:00:00Z")).state).toBe("no_data");
  });
  it("день в день — ещё не просрочено; следующий день — уже", () => {
    expect(computeState("2026-09-21T00:00:00Z", P, at("2026-09-21T23:59:00Z")).state).toBe(
      "expiring",
    );
    expect(computeState("2026-09-21T00:00:00Z", P, at("2026-09-22T00:01:00Z")).state).toBe(
      "overdue",
    );
  });
  it("далеко до конца — ok; граница предупреждения", () => {
    expect(computeState("2026-10-21T00:00:00Z", P, at("2026-09-21T10:00:00Z")).state).toBe("ok");
    expect(computeState("2026-09-26T00:00:00Z", P, at("2026-09-21T10:00:00Z")).state).toBe(
      "expiring",
    );
    expect(computeState("2026-09-27T00:00:00Z", P, at("2026-09-21T10:00:00Z")).state).toBe("ok");
  });
  it("граница отсрочки; нулевая отсрочка — на следующий день сразу grace_over", () => {
    expect(computeState("2026-09-18T00:00:00Z", P, at("2026-09-21T10:00:00Z")).state).toBe(
      "overdue",
    );
    expect(computeState("2026-09-17T00:00:00Z", P, at("2026-09-21T10:00:00Z")).state).toBe(
      "grace_over",
    );
    expect(
      computeState("2026-09-20T00:00:00Z", { ...P, grace_days: 0 }, at("2026-09-21T10:00:00Z"))
        .state,
    ).toBe("grace_over");
  });
  it("время суток не меняет состояние в пределах дня; daysLeft отрицательный при просрочке", () => {
    const a = computeState("2026-09-25T23:00:00Z", P, at("2026-09-21T00:30:00Z"));
    const b = computeState("2026-09-25T00:30:00Z", P, at("2026-09-21T23:30:00Z"));
    expect(a.state).toBe(b.state);
    expect(a.daysLeft).toBe(4);
    expect(computeState("2026-09-19T00:00:00Z", P, at("2026-09-21T10:00:00Z")).daysLeft).toBe(-2);
  });
});

describe("readPolicy", () => {
  it("пусто — значения по умолчанию; suspend распознаётся, остальное — warn", () => {
    expect(readPolicy(undefined)).toEqual(DEFAULT_POLICY);
    expect(readPolicy({ on_overdue: "suspend" }).on_overdue).toBe("suspend");
    expect(readPolicy({ on_overdue: "kick" }).on_overdue).toBe("warn");
  });
  it("нечисловые сроки — по умолчанию; ноль — настоящее значение", () => {
    expect(readPolicy({ warn_days_before: "7", grace_days: null })).toMatchObject({
      warn_days_before: 5,
      grace_days: 3,
    });
    expect(readPolicy({ warn_days_before: 0, grace_days: 0 })).toMatchObject({
      warn_days_before: 0,
      grace_days: 0,
    });
  });
});

describe("тексты владельцу", () => {
  it("до истечения — «заканчивается через», после — «просрочена на»", () => {
    expect(warnText(3, true)).toMatch(/через 3 дн\..*приостановлен/s);
    expect(warnText(-2, false)).toMatch(/просрочена на 2 дн\..*продолжит работать/s);
  });
});
