import { describe, expect, it } from "vitest";
import { replyWindow, windowLeftParts, serverClockOffset } from "./reply-window";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("окно ответа 24 часа в «Чате»", () => {
  it("открыто 24 часа с последнего входящего, остаток — до закрытия", () => {
    expect(replyWindow("whatsapp", ago(20), NOW)).toEqual({
      state: "open",
      closesAt: "2026-09-27T16:00:00.000Z",
      leftMs: 4 * 3_600_000,
    });
    expect(replyWindow("instagram", ago(0.5), NOW)).toMatchObject({ state: "open" });
  });

  it("ровно 24 часа и больше — закрыто, с момента закрытия", () => {
    expect(replyWindow("instagram", ago(24), NOW)).toEqual({
      state: "closed",
      since: "2026-09-27T12:00:00.000Z",
    });
    expect(replyWindow("whatsapp", ago(30), NOW)).toEqual({
      state: "closed",
      since: "2026-09-27T06:00:00.000Z",
    });
  });

  it("входящих нет — закрыто, без времени", () => {
    expect(replyWindow("whatsapp", null, NOW)).toEqual({ state: "closed", since: null });
    expect(replyWindow("whatsapp", "не дата", NOW)).toEqual({ state: "closed", since: null });
  });

  it("у Telegram окна нет", () => {
    expect(replyWindow("telegram", ago(100), NOW)).toBeNull();
    expect(replyWindow("site", null, NOW)).toBeNull();
  });

  it("остаток словами округляется вниз", () => {
    expect(windowLeftParts(5 * 3_600_000 + 12 * 60_000 + 59_000)).toEqual({ h: 5, m: 12 });
    expect(windowLeftParts(59_000)).toEqual({ h: 0, m: 0 });
    expect(windowLeftParts(-1)).toEqual({ h: 0, m: 0 });
  });
});

describe("окно 24 часа — по часам сервера, а не браузера", () => {
  it("часы компьютера продавца спешат на 3 часа — остаток всё равно по серверу", () => {
    const serverNow = "2026-09-27T12:00:00Z";
    const clientNow = Date.parse(serverNow) + 3 * 3_600_000;
    const offset = serverClockOffset(serverNow, clientNow);
    const w = replyWindow("whatsapp", "2026-09-27T00:00:00Z", clientNow + offset);
    expect(w).toMatchObject({ state: "open", leftMs: 12 * 3_600_000 });
  });

  it("время сервера не пришло или битое — смещения нет", () => {
    expect(serverClockOffset(undefined, 1000)).toBe(0);
    expect(serverClockOffset("не дата", 1000)).toBe(0);
  });
});
