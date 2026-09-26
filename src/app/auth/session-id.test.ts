import { describe, expect, it } from "vitest";
import {
  isSessionId,
  issueSession,
  operatorSessionMark,
  revocationExpiresAt,
  revokedKey,
  sessionFresh,
  SESSION_MAX_AGE_S,
} from "./session-id";

const DAY = 24 * 3600 * 1000;

describe("номер сессии", () => {
  it("каждый вход — свой номер и время выдачи", () => {
    const a = issueSession(1_000);
    const b = issueSession(1_000);
    expect(isSessionId(a.sid)).toBe(true);
    expect(a.sid).not.toBe(b.sid);
    expect(a.iat).toBe(1_000);
    const op = operatorSessionMark(5);
    expect(isSessionId(op.operatorSid)).toBe(true);
    expect(op.operatorIat).toBe(5);
  });

  it("cookie без номера или с мусором вместо номера не принимается", () => {
    for (const v of [undefined, null, "", "abc", 42, "00000000-0000-0000-0000-00000000000Z"])
      expect(isSessionId(v), String(v)).toBe(false);
  });

  it("сессия старше 14 дней или «из будущего» не принимается", () => {
    const now = 100 * DAY;
    expect(sessionFresh(now - DAY, now)).toBe(true);
    expect(sessionFresh(now - SESSION_MAX_AGE_S * 1000 + 1000, now)).toBe(true);
    expect(sessionFresh(now - SESSION_MAX_AGE_S * 1000, now)).toBe(false);
    expect(sessionFresh(now + 30_000, now)).toBe(true);
    expect(sessionFresh(now + 5 * 60_000, now)).toBe(false);
    for (const v of [undefined, "1", NaN, Infinity]) expect(sessionFresh(v, now)).toBe(false);
  });

  it("запись об отзыве живёт, пока сессия могла бы жить", () => {
    const now = 100 * DAY;
    expect(revocationExpiresAt(now - DAY, now)).toBe(
      new Date(now - DAY + SESSION_MAX_AGE_S * 1000).toISOString(),
    );
    // без времени выдачи или с временем «из будущего» — от текущего момента
    expect(revocationExpiresAt(undefined, now)).toBe(
      new Date(now + SESSION_MAX_AGE_S * 1000).toISOString(),
    );
    expect(revocationExpiresAt(now + DAY, now)).toBe(
      new Date(now + SESSION_MAX_AGE_S * 1000).toISOString(),
    );
    expect(revokedKey("x")).toBe("session_revoked:x");
  });
});
