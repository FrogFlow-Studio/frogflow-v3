import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAUSE_HOURS,
  isIndefinite,
  pauseHours,
  pauseNoticeRu,
  pausedUntilIso,
  validPauseHours,
} from "./pause";

const HOUR = 3600_000;
const now = Date.parse("2026-09-27T06:00:00Z");

describe("пауза консультанта после ответа человека", () => {
  it("по умолчанию 6 часов, как в v1", () => {
    expect(DEFAULT_PAUSE_HOURS).toBe(6);
    expect(pauseHours({ settings: {} })).toBe(6);
  });

  it("берёт выбор продавца и не пускает чужие значения", () => {
    expect(pauseHours({ settings: { consultant_pause_hours: 3 } })).toBe(3);
    expect(pauseHours({ settings: { consultant_pause_hours: 0 } })).toBe(0);
    expect(validPauseHours(5)).toBeUndefined();
    expect(validPauseHours("12")).toBeUndefined();
    expect(validPauseHours(-1)).toBeUndefined();
    expect(pauseHours({ settings: { consultant_pause_hours: 12 } })).toBe(12);
    expect(pauseHours({ settings: { consultant_pause_hours: 6 } })).toBe(6);
    expect(pauseHours({ settings: { consultant_pause_hours: 7 } })).toBe(6);
  });

  it("срок паузы: часы или «пока не верну сам»", () => {
    expect(Date.parse(pausedUntilIso(1, now)) - now).toBe(HOUR);
    expect(Date.parse(pausedUntilIso(24, now)) - now).toBe(24 * HOUR);
    const forever = pausedUntilIso(0, now);
    expect(isIndefinite(forever, now)).toBe(true);
    expect(isIndefinite(pausedUntilIso(24, now), now)).toBe(false);
    expect(isIndefinite(null, now)).toBe(false);
  });

  it("текст продавцу согласован с числом", () => {
    expect(pauseNoticeRu(1)).toBe("молчит 1 час");
    expect(pauseNoticeRu(3)).toBe("молчит 3 часа");
    expect(pauseNoticeRu(6)).toBe("молчит 6 часов");
    expect(pauseNoticeRu(12)).toBe("молчит 12 часов");
    expect(pauseNoticeRu(24)).toBe("молчит 24 часа");
    expect(pauseNoticeRu(0)).toMatch(/пока вы не вернёте/);
  });
});
