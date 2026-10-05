import { describe, expect, it } from "vitest";
import { answerHours, answerLabel, buildTrust, median, parseTrust } from "./trust";

describe("доверие автора: чистые правила (П3)", () => {
  it("медиана чётного, нечётного и пустого списка", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("время ответа: меньше пяти ответов продавца — не показываем; медиана часов", () => {
    const orders = [1, 2, 3, 4, 5, 6].map((id) => ({ id, createdAt: "2026-10-01T10:00:00.000Z" }));
    const at = (h: number) =>
      new Date(Date.parse("2026-10-01T10:00:00.000Z") + h * 3_600_000).toISOString();
    const four = new Map([
      [1, at(1)],
      [2, at(2)],
      [3, at(3)],
      [4, at(4)],
    ]);
    expect(answerHours(orders, four)).toBeNull();
    const five = new Map([...four, [5, at(10)]]);
    expect(answerHours(orders, five)).toBe(3);
    // ответ «до оформления» и заказ без ответа в счёт не идут
    const odd = new Map([...five, [6, at(-5)]]);
    expect(answerHours(orders, odd)).toBe(3);
  });

  it("выдано округляется вниз: меньше десяти — 0, без точного оборота", () => {
    const base = {
      now: new Date("2026-10-05T00:00:00Z"),
      answerHours: null,
      rating: null,
      ratingCount: 0,
    };
    expect(buildTrust({ ...base, deliveredTotal: 7 }).delivered).toBe(0);
    expect(buildTrust({ ...base, deliveredTotal: 57 }).delivered).toBe(50);
    expect(buildTrust({ ...base, deliveredTotal: 1234 }).delivered).toBe(1200);
  });

  it("запись из настроек: чужое и испорченное — null, лишнее отбрасывается", () => {
    expect(parseTrust(null)).toBeNull();
    expect(parseTrust("{не json")).toBeNull();
    expect(parseTrust(JSON.stringify({ v: 2, at: "x" }))).toBeNull();
    const ok = parseTrust(
      JSON.stringify({
        v: 1,
        at: "2026-10-05T00:00:00Z",
        delivered: 50.9,
        answerHours: "3",
        rating: 4.5,
        ratingCount: 12,
        extra: 1,
      }),
    );
    expect(ok).toEqual({
      v: 1,
      at: "2026-10-05T00:00:00Z",
      delivered: 50,
      answerHours: null,
      rating: 4.5,
      ratingCount: 12,
    });
  });

  it("подпись времени: минуты, часы, дни", () => {
    expect(answerLabel(0.2)).toEqual({ unit: "min", n: 12 });
    expect(answerLabel(3.4)).toEqual({ unit: "h", n: 3 });
    expect(answerLabel(72)).toEqual({ unit: "d", n: 3 });
  });
});
