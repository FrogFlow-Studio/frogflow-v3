import { describe, expect, it } from "vitest";
import { outboxDead, outboxNextAt, outboxPermanentFailure } from "./pure";

describe("повторы исходящих", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  it("пауза растёт: 1, 5, 15, 60, 180 минут, шестой попытки нет", () => {
    const at = (n: number) => outboxNextAt(n, now)?.toISOString();
    expect(at(1)).toBe("2026-09-25T10:01:00.000Z");
    expect(at(2)).toBe("2026-09-25T10:05:00.000Z");
    expect(at(3)).toBe("2026-09-25T10:15:00.000Z");
    expect(at(4)).toBe("2026-09-25T11:00:00.000Z");
    expect(outboxNextAt(5, now)).toBeNull();
    expect(outboxDead(4)).toBe(false);
    expect(outboxDead(5)).toBe(true);
  });
  it("заблокировавшего бота покупателя не дёргаем повторно", () => {
    expect(outboxPermanentFailure("Forbidden: bot was blocked by the user")).toBe(true);
    expect(outboxPermanentFailure("Bad Request: chat not found")).toBe(true);
    expect(outboxPermanentFailure("Too Many Requests: retry after 5")).toBe(false);
    expect(outboxPermanentFailure(null)).toBe(false);
  });
});
