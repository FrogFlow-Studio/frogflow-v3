import { describe, expect, it } from "vitest";
import { localDayHour, morningRows, morningText, pulseUnread } from "./morning-brief";
import { computePulse } from "./pulse";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const quiet = computePulse({
  ordersAt: [ago(20), ago(21), ago(22), ago(23), ago(1)],
  lastLoginAt: ago(2),
  lastOrderAt: ago(1),
  createdAt: ago(300),
  status: "active",
  now,
});
const fine = computePulse({
  ...{ ordersAt: [ago(1)], lastLoginAt: ago(1), lastOrderAt: ago(1) },
  createdAt: ago(300),
  status: "active",
  now,
});
const ok = { state: "ok", daysLeft: 20, policy: "grace" } as never;

describe("утренняя сводка", () => {
  it("берёт затихших, подписку и сбои; здоровых не трогает; порядок по тяжести", () => {
    const rows = morningRows([
      { id: "a", name: "Тихий", pulse: quiet, subscription: ok, health: null },
      {
        id: "b",
        name: "Здоровый",
        pulse: fine,
        subscription: ok,
        health: { ok: true, at: "", error: null, pending: 0 },
      },
      {
        id: "c",
        name: "Должник",
        pulse: null,
        subscription: { state: "overdue", daysLeft: -3, policy: "grace" } as never,
        health: null,
      },
      {
        id: "d",
        name: "Упал",
        pulse: null,
        subscription: ok,
        health: { ok: false, at: "", error: "нет токена", pending: 0 },
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["d", "c", "a"]);
    expect(rows[1]!.reasons).toEqual(["подписка просрочена на 3 дн"]);
    expect(rows[2]!.reasons[0]).toContain("заказы 1 против 4");
  });
  it("текст: ссылка на карточку, экранирование; пусто — null", () => {
    const rows = morningRows([
      {
        id: "x",
        name: "A<b>&",
        pulse: null,
        subscription: { state: "expiring", daysLeft: 2, policy: "grace" } as never,
        health: null,
      },
    ]);
    const t = morningText(rows, "https://f.tech")!;
    expect(t).toContain('href="https://f.tech/operator/clients/x"');
    expect(t).toContain("A&lt;b&gt;&amp;");
    expect(morningText([], "https://f.tech")).toBeNull();
  });
  it("день и час по поясу платформы", () => {
    expect(localDayHour(new Date("2026-10-20T20:30:00Z"), "Asia/Almaty")).toEqual({
      day: "2026-10-21",
      hour: 1,
    });
  });
  it("длинная причина сбоя обрезается до 120 знаков", () => {
    const rows = morningRows([
      {
        id: "z",
        name: "Z",
        pulse: null,
        subscription: ok,
        health: { ok: false, at: "", error: "я".repeat(500), pending: 0 },
      },
    ]);
    expect(rows[0]!.reasons[0]!.length).toBeLessThanOrEqual("сбой: ".length + 120);
  });
  it("пульс не прочитан у всех v2 — строка-предупреждение; пусто и пульс есть — null", () => {
    expect(pulseUnread([{ pulse: null }, { pulse: null }])).toBe(true);
    expect(pulseUnread([{ pulse: null }, { pulse: fine }])).toBe(false);
    expect(pulseUnread([])).toBe(false);
    expect(morningText([], "https://f.tech", true)).toContain("пульс клиентов не прочитан");
    expect(morningText([], "https://f.tech", false)).toBeNull();
  });
});
