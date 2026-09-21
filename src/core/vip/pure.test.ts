import { describe, expect, it } from "vitest";
import {
  addTariffDuration,
  addWarnOffset,
  fmt,
  formatDateTime,
  inviteExpireDate,
  isAlreadyNotInChat,
  memberStatusExempt,
  memberStatusIsInGroup,
  pickLatestPerUser,
  resolveVipExtension,
  resolveWarnWindows,
  TEST_MODE_DEFAULT_MINUTES,
} from "./pure";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("inviteExpireDate", () => {
  const now = 1_000_000_000_000;
  it("зажимает снизу: короткая подписка даёт хотя бы 10 минут на переход", () => {
    expect(inviteExpireDate(new Date(now + MIN), now) * 1000 - now).toBe(10 * MIN);
  });
  it("зажимает сверху: многомесячная подписка не даёт ссылке жить дольше суток", () => {
    expect(inviteExpireDate(new Date(now + 90 * DAY), now) * 1000 - now).toBe(DAY);
  });
  it("между границами — срок подписки как есть; на границах не пересекает их", () => {
    expect(inviteExpireDate(new Date(now + 3 * HOUR), now) * 1000 - now).toBe(3 * HOUR);
    expect(inviteExpireDate(new Date(now + 10 * MIN), now) * 1000 - now).toBe(10 * MIN);
    expect(inviteExpireDate(new Date(now + DAY), now) * 1000 - now).toBe(DAY);
  });
});

describe("addTariffDuration / addWarnOffset", () => {
  const base = new Date("2026-01-01T00:00:00Z");
  it("обычный режим — дни тарифа, без duration_days — 30", () => {
    expect(addTariffDuration(base, { duration_days: 30 }, false).toISOString()).toBe(
      "2026-01-31T00:00:00.000Z",
    );
    expect(addTariffDuration(base, null, false).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
  it("тест-режим — МИНУТЫ, не дни (источник прод-инцидента); 0 и пусто — умолчание", () => {
    expect(
      addTariffDuration(base, { duration_minutes: 5, duration_days: 30 }, true).toISOString(),
    ).toBe("2026-01-01T00:05:00.000Z");
    expect(addTariffDuration(base, { duration_days: 30 }, true).getTime() - base.getTime()).toBe(
      TEST_MODE_DEFAULT_MINUTES * MIN,
    );
    expect(addTariffDuration(base, { duration_minutes: 0 }, true).getTime() - base.getTime()).toBe(
      TEST_MODE_DEFAULT_MINUTES * MIN,
    );
  });
  it("окна предупреждений сдвигаются на дни или минуты", () => {
    expect(addWarnOffset(base, 3, false).toISOString()).toBe("2026-01-04T00:00:00.000Z");
    expect(addWarnOffset(base, 3, true).toISOString()).toBe("2026-01-01T00:03:00.000Z");
  });
});

describe("resolveWarnWindows", () => {
  it("валидные значения как есть, умолчания 3/1 на пусто, мусор и <1", () => {
    expect(resolveWarnWindows("3", "1")).toEqual({ warnDays: 3, warnDays2: 1 });
    expect(resolveWarnWindows("", "")).toEqual({ warnDays: 3, warnDays2: 1 });
    expect(resolveWarnWindows("abc", "xyz")).toEqual({ warnDays: 3, warnDays2: 1 });
    expect(resolveWarnWindows("0", "-5")).toEqual({ warnDays: 3, warnDays2: 1 });
  });
  it("второе окно строго ближе первого, но не ниже 1", () => {
    expect(resolveWarnWindows("2", "3")).toEqual({ warnDays: 2, warnDays2: 1 });
    expect(resolveWarnWindows("2", "2")).toEqual({ warnDays: 2, warnDays2: 1 });
    expect(resolveWarnWindows("1", "1")).toEqual({ warnDays: 1, warnDays2: 1 });
  });
});

describe("pickLatestPerUser", () => {
  it("пусто на null; по одной строке на пользователя с самой поздней датой", () => {
    expect(pickLatestPerUser(null)).toEqual([]);
    const rows = [
      { telegram_id: 1, expires_at: "2026-01-10T00:00:00Z", tag: "old" },
      { telegram_id: 1, expires_at: "2026-02-10T00:00:00Z", tag: "new" },
      { telegram_id: 2, expires_at: "2026-01-15T00:00:00Z", tag: "only" },
    ];
    const r = pickLatestPerUser(rows);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.telegram_id === 1)?.tag).toBe("new");
  });
});

describe("resolveVipExtension", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  it("активная — от текущего срока; истёкшая или просроченная — от «сейчас»", () => {
    const a = resolveVipExtension(
      { status: "active", expires_at: "2026-07-01T00:00:00Z" },
      10,
      now,
    );
    expect(a.wasInactive).toBe(false);
    expect(a.baseSafe.toISOString()).toBe("2026-07-11T00:00:00.000Z");
    const e = resolveVipExtension(
      { status: "expired", expires_at: "2026-01-01T00:00:00Z" },
      10,
      now,
    );
    expect(e.wasInactive).toBe(true);
    expect(e.baseSafe.toISOString()).toBe("2026-06-25T12:00:00.000Z");
    const p = resolveVipExtension({ status: "active", expires_at: "2026-06-01T00:00:00Z" }, 5, now);
    expect(p.wasInactive).toBe(true);
    expect(p.baseSafe.toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });
  it("уменьшение в прошлое помечается shortenedPast, в будущее — нет", () => {
    expect(
      resolveVipExtension({ status: "active", expires_at: "2026-06-16T00:00:00Z" }, -2, now)
        .shortenedPast,
    ).toBe(true);
    expect(
      resolveVipExtension({ status: "active", expires_at: "2026-07-01T00:00:00Z" }, -2, now)
        .shortenedPast,
    ).toBe(false);
  });
});

describe("статусы участника и ошибки Telegram", () => {
  it("узнаёт «уже не в чате», участника и освобождённых от подписки", () => {
    expect(isAlreadyNotInChat("Bad Request: USER_NOT_PARTICIPANT")).toBe(true);
    expect(isAlreadyNotInChat("Bad Request: not enough rights")).toBe(false);
    expect(isAlreadyNotInChat(undefined)).toBe(false);
    expect(memberStatusIsInGroup("restricted")).toBe(true);
    expect(memberStatusIsInGroup("left")).toBe(false);
    expect(memberStatusExempt("administrator")).toBe(true);
    expect(memberStatusExempt("member")).toBe(false);
  });
  it("подставляет плейсхолдеры и форматирует дату в поясе клиента", () => {
    expect(
      fmt("Нажмите «{btn}» — {price} {currency}", {
        btn: "Продлить",
        price: "10",
        currency: "KZT",
      }),
    ).toBe("Нажмите «Продлить» — 10 KZT");
    expect(formatDateTime("2026-09-21T09:04:00Z", "Asia/Almaty")).toBe("21.09.2026, 14:04");
  });
});
