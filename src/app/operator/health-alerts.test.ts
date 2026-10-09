import { describe, expect, it } from "vitest";
import {
  ERROR_MAX,
  RECOVER_THRESHOLD,
  THRESHOLD,
  alertSummaryText,
  alertText,
  cronProbe,
  formatDowntime,
  INBOUND_ACTIVE_MIN,
  inboundProbe,
  parseAlertStates,
  parsePlatformKey,
  platformAlertText,
  platformKey,
  platformSummaryText,
  rateProbe,
  stepHealthAlerts,
  zernioWebhookProbe,
  type AlertStates,
  type HealthProbe,
} from "./health-alerts";
import { platformProbes, rateReading, rateTenantIds } from "./platform-alerts.server";
import { RATE_ALERT_AFTER_HOURS } from "@/core/consultant/pricelist/rate";

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

describe("платформа: кроны, вебхук Zernio, аккаунты", () => {
  const job = { job: "broadcast", everyMin: 1 };

  it("крон: молчит — сбой с понятной причиной; упал — его ошибка; в порядке — ок", () => {
    // Ни одного запуска (новая задача, суточный крон после выкладки) — не проверяем.
    expect(cronProbe({ ...job, stale: true, last: null })).toBeNull();
    expect(
      cronProbe({ ...job, stale: true, last: { at: T(0), ok: true, error: null } })?.error,
    ).toBe("не запускался дольше 2 мин");
    expect(
      cronProbe({ ...job, stale: false, last: { at: T(0), ok: false, error: "таймаут" } }),
    ).toMatchObject({ ok: false, error: "таймаут" });
    expect(cronProbe({ ...job, stale: false, last: { at: T(0), ok: true, error: null } })?.ok).toBe(
      true,
    );
  });

  it("вебхук Zernio: запись, которую надо обновить, — сбой с подсказкой", () => {
    expect(zernioWebhookProbe({ ok: true, action: "unchanged" }).ok).toBe(true);
    expect(zernioWebhookProbe({ ok: false, action: "update" })).toEqual({
      bot_id: "zernio:webhook",
      ok: false,
      error: "вебхук v2 выключен или не видит профили клиентов v2",
    });
    expect(zernioWebhookProbe({ ok: false, action: "error", error: "HTTP 500" }).error).toBe(
      "HTTP 500",
    );
  });

  it("ключи разбираются обратно", () => {
    for (const s of [
      { kind: "cron", job: "health" },
      { kind: "zernio_webhook" },
      { kind: "account", botId: "b", accountId: "acc:1" },
    ] as const)
      expect(parsePlatformKey(platformKey(s))).toEqual(s);
    expect(parsePlatformKey("b")).toBeNull();
  });

  it("тексты: что сломалось, что делать и куда смотреть", () => {
    const o = {
      labels: new Map([["account:b:acc", "Instagram @aa_teach_ клиента «Education Bot»"]]),
      base: "https://ff.example",
      timeZone: "Asia/Almaty",
    };
    const zDown = platformAlertText(
      { kind: "down", botId: "zernio:webhook", since: T(0), error: "вебхука v2 нет" },
      o,
    );
    expect(zDown).toContain("Вебхук Zernio v2 не в порядке");
    expect(zDown).toContain("«Привязать»");
    expect(zDown).toContain("https://ff.example/operator/settings");
    const accDown = platformAlertText(
      { kind: "down", botId: "account:b:acc", since: T(0), error: "аккаунт отвязан" },
      o,
    );
    expect(accDown).toContain("Instagram @aa_teach_ клиента «Education Bot» отключился");
    expect(accDown).toContain("https://ff.example/operator/clients/b");
    const accUp = platformAlertText(
      { kind: "up", botId: "account:b:acc", since: T(0), at: T(90) },
      o,
    );
    expect(accUp).toContain("снова подключён");
    expect(accUp).toContain("Простой: 1 ч 30 мин.");
    expect(
      platformSummaryText(
        [
          { kind: "down", botId: "cron:vip", since: T(0), error: null },
          { kind: "up", botId: "zernio:webhook", since: T(0), at: T(30) },
        ],
        { labels: new Map([["cron:vip", "VIP-подписки"]]), base: o.base },
      ),
    ).toContain("Платформа: сбоев 1, восстановлено 1");
  });
});

describe("проверки платформы из показаний", () => {
  const tenant = (id: string, served: "v1" | "v2", accounts: object[]) => ({
    id,
    name: `Клиент ${id}`,
    archived: false,
    settings: { served_by: served, zernio: { accounts } } as never,
  });

  it("кроны, вебхук и аккаунты только клиентов v2; отвязанный аккаунт — сбой", () => {
    const { probes, labels } = platformProbes({
      crons: [
        { job: "vip", everyMin: 10, stale: false, last: { at: T(0), ok: true, error: null } },
      ],
      zernioWebhook: { ok: false, action: "create" },
      tenants: [
        tenant("b", "v2", [
          { id: "ig1", platform: "instagram", username: "shop", expired: true },
          { id: "wa1", platform: "whatsapp", name: "+7700" },
        ]),
        tenant("old", "v1", [{ id: "ig2", platform: "instagram", expired: true }]),
      ],
      cronTitles: new Map([["vip", "VIP-подписки"]]),
    });
    expect(probes.map((p) => [p.bot_id, p.ok])).toEqual([
      ["cron:vip", true],
      ["zernio:webhook", false],
      ["account:b:ig1", false],
      ["account:b:wa1", true],
    ]);
    expect(labels.get("cron:vip")).toBe("VIP-подписки");
    expect(labels.get("account:b:ig1")).toBe("Instagram @shop клиента «Клиент b»");
    expect(labels.get("account:b:wa1")).toBe("WhatsApp +7700 клиента «Клиент b»");
  });

  it("нет клиентов v2 с Zernio — вебхук не проверяется", () => {
    const { probes } = platformProbes({
      crons: [],
      zernioWebhook: null,
      tenants: [],
      cronTitles: new Map(),
    });
    expect(probes).toEqual([]);
  });
});

describe("сутки без входящих у клиента (BOVI 07.10: трое суток сообщения не доходили)", () => {
  const now = Date.parse(T(0));
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it("обычно пишут, а сутки тишина — сбой с длительностью", () => {
    expect(inboundProbe({ botId: "b", last: hoursAgo(26), weekBefore: 40, now })).toEqual({
      bot_id: "inbound:b",
      ok: false,
      error: `нет входящих ${formatDowntime(26 * 3_600_000)}`,
    });
  });

  it("меньше суток, редко пишущий клиент или ни одного входящего — не сбой", () => {
    expect(inboundProbe({ botId: "b", last: hoursAgo(23), weekBefore: 40, now })?.ok).toBe(true);
    expect(
      inboundProbe({ botId: "b", last: hoursAgo(72), weekBefore: INBOUND_ACTIVE_MIN - 1, now })?.ok,
    ).toBe(true);
    expect(inboundProbe({ botId: "b", last: null, weekBefore: 0, now })).toBeNull();
  });

  it("проба и подпись в общем прогоне, текст ведёт в карточку клиента", () => {
    const { probes, labels } = platformProbes({
      crons: [],
      zernioWebhook: null,
      tenants: [
        {
          id: "bovi",
          name: "BOVI",
          archived: false,
          settings: { served_by: "v2", zernio: { accounts: [] } } as never,
        },
      ],
      cronTitles: new Map(),
      inbound: [{ botId: "bovi", last: hoursAgo(30), weekBefore: 50 }],
      now,
    });
    expect(probes).toContainEqual(expect.objectContaining({ bot_id: "inbound:bovi", ok: false }));
    expect(parsePlatformKey("inbound:bovi")).toEqual({ kind: "inbound", botId: "bovi" });
    const o = { labels, base: "https://ff.example", timeZone: "Asia/Almaty" };
    const down = platformAlertText(
      { kind: "down", botId: "inbound:bovi", since: T(0), error: "нет входящих 1 д 6 ч" },
      o,
    );
    expect(down).toContain("Клиент «BOVI»: сутки нет входящих сообщений");
    expect(down).toContain("https://ff.example/operator/clients/bovi");
    const up = platformAlertText({ kind: "up", botId: "inbound:bovi", since: T(0), at: T(60) }, o);
    expect(up).toContain("Клиент «BOVI»: входящие снова идут");
  });
});

describe("курс рубля консультанта не обновляется (BOVI 09.10: рубли пропали молча)", () => {
  const now = Date.parse(T(0));
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const bovi = {
    id: "bovi",
    name: "BOVI",
    archived: false,
    settings: { served_by: "v2", consultant_pricelist: { enabled: true } } as never,
  };

  it("шесть часов без обновления — сбой с причиной из журнала попытки", () => {
    expect(RATE_ALERT_AFTER_HOURS).toBe(6);
    const p = rateProbe({
      botId: "b",
      updatedAt: hoursAgo(7),
      lastError: "Kaspi (finkaz.kz): HTTP 503",
      alertAfterHours: RATE_ALERT_AFTER_HOURS,
      now,
    });
    expect(p).toEqual({
      bot_id: "rate:b",
      ok: false,
      error: `курс не обновлялся ${formatDowntime(7 * 3_600_000)}; последняя попытка: Kaspi (finkaz.kz): HTTP 503`,
    });
  });

  it("моложе шести часов — в порядке; курса нет — сбой", () => {
    const base = { botId: "b", alertAfterHours: 6, now };
    expect(rateProbe({ ...base, updatedAt: hoursAgo(5) }).ok).toBe(true);
    expect(rateProbe({ ...base, updatedAt: null })).toMatchObject({
      ok: false,
      error: "курса нет",
    });
  });

  it("журнал попытки: неудачная — в причину, удачная или битая — без причины", () => {
    const rate = {
      key: "consultant_vtb_buy_rate",
      value: JSON.stringify({ rate: 4.36, updatedAt: hoursAgo(8) }),
    };
    const failed = {
      key: "consultant_vtb_last_error",
      value: JSON.stringify({ at: hoursAgo(0), ok: false, attempts: ["finkaz: тайм-аут"] }),
    };
    expect(rateReading("b", [rate, failed])).toEqual({
      botId: "b",
      updatedAt: hoursAgo(8),
      lastError: "finkaz: тайм-аут",
    });
    expect(
      rateReading("b", [rate, { key: "consultant_vtb_last_error", value: "{" }]).lastError,
    ).toBeNull();
    expect(rateReading("b", [])).toEqual({ botId: "b", updatedAt: null, lastError: null });
  });

  it("два прогона подряд — одно сообщение оператору со ссылкой на клиента; обновился — «снова обновляется»", () => {
    const run = (prev: AlertStates, updatedAt: string, at: number) => {
      const { probes, labels } = platformProbes({
        crons: [],
        zernioWebhook: null,
        tenants: [bovi],
        cronTitles: new Map(),
        rates: [{ botId: "bovi", updatedAt, lastError: null }],
        now: at,
      });
      return { ...stepHealthAlerts(prev, probes, new Date(at).toISOString()), labels };
    };
    const first = run({}, hoursAgo(7), now);
    expect(first.events).toEqual([]);
    const second = run(first.next, hoursAgo(7), now + 15 * 60_000);
    expect(second.events).toHaveLength(1);
    const o = { labels: second.labels, base: "https://ff.example", timeZone: "Asia/Almaty" };
    const down = platformAlertText(second.events[0]!, o);
    expect(down).toContain("Консультант клиента «BOVI»: курс рубля не обновляется");
    expect(down).toContain("ориентировочно");
    expect(down).toContain("https://ff.example/operator/clients/bovi");
    expect(parsePlatformKey("rate:bovi")).toEqual({ kind: "rate", botId: "bovi" });

    const fresh = new Date(now + 30 * 60_000).toISOString();
    let state = second.next;
    state = { ...state, "rate:bovi": { ...state["rate:bovi"]!, notified: true } };
    const r1 = run(state, fresh, now + 30 * 60_000);
    const r2 = run(r1.next, fresh, now + 45 * 60_000);
    expect(r2.events).toHaveLength(1);
    expect(platformAlertText(r2.events[0]!, o)).toContain("курс рубля снова обновляется");
  });

  it("проверяются только консультанты по прайсу с курсом не вручную", () => {
    const t = (id: string, consultant_pricelist: unknown) => ({
      id,
      settings: { consultant_pricelist } as never,
    });
    expect(
      rateTenantIds([
        t("bovi", { enabled: true }),
        t("vtb", { enabled: true, rate_source: "vtb" }),
        t("hand", { enabled: true, rate_source: "manual" }),
        t("off", { enabled: false }),
        t("none", undefined),
      ]),
    ).toEqual(["bovi", "vtb"]);
  });
});
