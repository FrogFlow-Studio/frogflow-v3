import { describe, expect, it } from "vitest";
import {
  ERROR_MAX,
  RECOVER_THRESHOLD,
  THRESHOLD,
  alertSummaryText,
  alertText,
  formatDowntime,
  parseAlertStates,
  stepHealthAlerts,
  type AlertStates,
  type HealthProbe,
} from "./health-alerts";

const T = (min: number) => new Date(Date.UTC(2026, 8, 27, 3, 0) + min * 60_000).toISOString();
const bad = (bot_id = "b", error = "вебхук: не установлен"): HealthProbe => ({
  bot_id,
  ok: false,
  error,
});
const good = (bot_id = "b"): HealthProbe => ({ bot_id, ok: true, error: null });

/** Прогоны крона подряд; notified ставится, как если бы сообщение ушло. */
function runs(seq: HealthProbe[][], delivered = true) {
  let st: AlertStates = {};
  const all: Array<{ kind: string; botId: string }> = [];
  seq.forEach((probes, i) => {
    const { next, events } = stepHealthAlerts(st, probes, T(i * 15));
    for (const e of events) {
      all.push({ kind: e.kind, botId: e.botId });
      if (e.kind === "down" && delivered) next[e.botId]!.notified = true;
    }
    st = next;
  });
  return { events: all, state: st };
}

describe("переходы «сбой / восстановление»", () => {
  it("одна неудачная проверка — не сбой", () => {
    expect(runs([[bad()], [good()], [good()]]).events).toEqual([]);
  });

  it(`сбой — ${THRESHOLD} проверки подряд; одно сообщение на сбой и одно на восстановление`, () => {
    const r = runs([[bad()], [bad()], [bad()], [bad()], [good()], [good()], [good()]]);
    expect(r.events).toEqual([
      { kind: "down", botId: "b" },
      { kind: "up", botId: "b" },
    ]);
    expect(r.state).toEqual({});
  });

  it("сообщение о сбое не ушло — повтор на следующем прогоне, «ожил» без сбоя не пишется", () => {
    const r = runs([[bad()], [bad()], [bad()], [good()]], false);
    expect(r.events).toEqual([
      { kind: "down", botId: "b" },
      { kind: "down", botId: "b" },
    ]);
  });

  it("начало сбоя — первая неудачная проверка, причина — последняя", () => {
    const s1 = stepHealthAlerts({}, [bad("b", "timeout")], T(0));
    const s2 = stepHealthAlerts(s1.next, [bad("b", "Unauthorized")], T(15));
    expect(s2.events).toEqual([{ kind: "down", botId: "b", since: T(0), error: "Unauthorized" }]);
  });

  it("боты независимы; бот без снимка (ушёл с v2, без токена) забывается молча", () => {
    const r = runs([[bad("a"), bad("b")], [bad("a"), good("b")], [good("c")]]);
    expect(r.events).toEqual([{ kind: "down", botId: "a" }]);
    expect(r.state).toEqual({});
  });
});

describe("мигающий бот", () => {
  it(`«снова отвечает» — после ${RECOVER_THRESHOLD} удачных проверок подряд; мигание не шлёт пару на каждый цикл`, () => {
    // Цикл «сбой, сбой, норма» восемь раз: одно сообщение о сбое и ни одного «ожил».
    const cycle = [[bad()], [bad()], [good()]];
    const r = runs(Array.from({ length: 8 }, () => cycle).flat());
    expect(r.events).toEqual([{ kind: "down", botId: "b" }]);
    expect(r.state.b).toMatchObject({ notified: true, oks: 1 });
    const done = runs([...Array.from({ length: 3 }, () => cycle).flat(), [good()]]);
    expect(done.events).toEqual([
      { kind: "down", botId: "b" },
      { kind: "up", botId: "b" },
    ]);
  });

  it("сбой без сообщения заканчивается с первой удачной проверкой", () => {
    const r = runs([[bad()], [good()], [bad()]]);
    expect(r.events).toEqual([]);
    expect(r.state.b).toMatchObject({ fails: 1 });
  });

  it("длинная причина обрезается", () => {
    const s1 = stepHealthAlerts({}, [bad("b", "x".repeat(5000))], T(0));
    expect(s1.next.b!.error).toHaveLength(ERROR_MAX);
  });

  it("сводка: имена и причины экранированы, есть ссылка на список клиентов", () => {
    const text = alertSummaryText(
      [
        { kind: "down", botId: "a", since: T(0), error: "<x>" },
        { kind: "down", botId: "b", since: T(0), error: null },
        { kind: "up", botId: "c", since: T(0), at: T(30) },
      ],
      { names: new Map([["a", "A&B"]]), panelUrl: "https://x/operator/clients" },
    );
    expect(text).toContain("Не отвечают боты клиентов: 2");
    expect(text).toContain("🔴 A&amp;B — &lt;x&gt;");
    expect(text).toContain("🟢 c — простой 30 мин");
    expect(text).toContain('href="https://x/operator/clients"');
  });
});

describe("сохранённое состояние и текст", () => {
  it("битое состояние читается как пустое", () => {
    expect(parseAlertStates(null)).toEqual({});
    expect(parseAlertStates("не json")).toEqual({});
    expect(parseAlertStates("[1]")).toEqual({});
    expect(
      parseAlertStates('{"a":{"fails":"x"},"b":{"fails":2,"since":"t","notified":true}}'),
    ).toEqual({
      b: { fails: 2, oks: 0, since: "t", error: null, notified: true },
    });
  });

  it("простой по-человечески", () => {
    expect(formatDowntime(10_000)).toBe("1 мин");
    expect(formatDowntime(45 * 60_000)).toBe("45 мин");
    expect(formatDowntime(65 * 60_000)).toBe("1 ч 5 мин");
    expect(formatDowntime(2 * 3_600_000)).toBe("2 ч");
    expect(formatDowntime(27 * 3_600_000)).toBe("1 дн 3 ч");
  });

  it("имя и причина экранируются, есть ссылка на клиента", () => {
    const o = {
      name: "Магазин <b>",
      panelUrl: "https://x/operator/clients/b",
      timeZone: "Asia/Almaty",
    };
    const down = alertText({ kind: "down", botId: "b", since: T(0), error: "a<b" }, o);
    expect(down).toContain("«Магазин &lt;b&gt;» не отвечает");
    expect(down).toContain("Причина: a&lt;b");
    expect(down).toMatch(/27 сентября.*08:00/); // Алматы UTC+5
    expect(down).toContain('href="https://x/operator/clients/b"');
    const up = alertText({ kind: "up", botId: "b", since: T(0), at: T(75) }, o);
    expect(up).toContain("снова отвечает");
    expect(up).toContain("Простой: 1 ч 15 мин.");
  });
});
