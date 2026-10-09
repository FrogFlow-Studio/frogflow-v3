import { escapeHtml } from "@/channels/telegram/copy";

/**
 * Сбои ботов для оператора: из снимков здоровья (health.server) — события
 * «упал» и «ожил». Чистая логика без базы, чтобы каждый переход был в тесте.
 *
 * Правила. Сбоем считаются THRESHOLD проверок подряд с ошибкой: одна
 * неудачная проверка раз в 15 минут бывает и у здорового бота. Про сбой
 * пишется одно сообщение; пока оно не ушло (канал не настроен, Telegram не
 * ответил) — пробуем на следующем прогоне, а после — молчим до конца сбоя.
 * «Ожил» пишется после RECOVER_THRESHOLD удачных проверок подряд и только
 * если про сбой оператору сообщили: мигающий бот не шлёт пару сообщений
 * на каждое мигание. Здоровый бот состояния не хранит.
 */
export const THRESHOLD = 2;
export const RECOVER_THRESHOLD = 2;
/** Причина сбоя в сообщении — не длиннее. */
export const ERROR_MAX = 300;

export type AlertState = {
  /** Проверок с ошибкой подряд. */
  fails: number;
  /** Удачных проверок подряд после сообщения о сбое. */
  oks: number;
  /** Первая неудачная проверка этого сбоя (ISO). */
  since: string;
  error: string | null;
  /** Сообщение о сбое ушло оператору. */
  notified: boolean;
};

export type AlertStates = Record<string, AlertState>;

export type HealthProbe = { bot_id: string; ok: boolean; error: string | null };

export type AlertEvent =
  | { kind: "down"; botId: string; since: string; error: string | null }
  | { kind: "up"; botId: string; since: string; at: string };

/** Шаг по одному прогону крона. Боты без снимка (ушли с v2, без токена) забываются молча. */
export function stepHealthAlerts(
  prev: AlertStates,
  probes: HealthProbe[],
  now: string,
): { next: AlertStates; events: AlertEvent[] } {
  const next: AlertStates = {};
  const events: AlertEvent[] = [];
  for (const p of probes) {
    const was = prev[p.bot_id];
    if (p.ok) {
      // Сбой, о котором не сообщали, заканчивается молча с первой удачной проверкой.
      if (!was?.notified) continue;
      const oks = was.oks + 1;
      if (oks >= RECOVER_THRESHOLD)
        events.push({ kind: "up", botId: p.bot_id, since: was.since, at: now });
      else next[p.bot_id] = { ...was, oks };
      continue;
    }
    const s: AlertState = {
      fails: (was?.fails ?? 0) + 1,
      oks: 0,
      since: was?.since ?? now,
      error: p.error ? p.error.slice(0, ERROR_MAX) : null,
      notified: was?.notified ?? false,
    };
    next[p.bot_id] = s;
    if (s.fails >= THRESHOLD && !s.notified)
      events.push({ kind: "down", botId: p.bot_id, since: s.since, error: s.error });
  }
  return { next, events };
}

/** Разбор сохранённого состояния: битое или чужое — как пустое. */
export function parseAlertStates(raw: string | null | undefined): AlertStates {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: AlertStates = {};
    for (const [id, s] of Object.entries(v as Record<string, Partial<AlertState>>))
      if (s && typeof s.fails === "number" && typeof s.since === "string")
        out[id] = {
          fails: s.fails,
          oks: typeof s.oks === "number" ? s.oks : 0,
          since: s.since,
          error: typeof s.error === "string" ? s.error : null,
          notified: s.notified === true,
        };
    return out;
  } catch {
    return {};
  }
}

/** «1 ч 5 мин», «40 мин», «2 дн 3 ч». */
export function formatDowntime(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d) return h ? `${d} дн ${h} ч` : `${d} дн`;
  if (h) return m ? `${h} ч ${m} мин` : `${h} ч`;
  return `${m} мин`;
}

function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Текст сообщения оператору (HTML Telegram). */
export function alertText(
  e: AlertEvent,
  o: { name: string; panelUrl: string; timeZone: string },
): string {
  const name = escapeHtml(o.name);
  const link = `<a href="${escapeHtml(o.panelUrl).replace(/"/g, "&quot;")}">Открыть клиента в панели</a>`;
  if (e.kind === "down")
    return [
      `🔴 <b>Бот клиента «${name}» не отвечает</b>`,
      `С ${formatTime(e.since, o.timeZone)}.`,
      e.error ? `Причина: ${escapeHtml(e.error)}` : null,
      link,
    ]
      .filter(Boolean)
      .join("\n");
  return [
    `🟢 <b>Бот клиента «${name}» снова отвечает</b>`,
    `Простой: ${formatDowntime(Date.parse(e.at) - Date.parse(e.since))}.`,
    link,
  ].join("\n");
}

/** С этого числа событий за прогон — одно сводное сообщение вместо пачки (лимит Telegram). */
export const SUMMARY_FROM = 4;

/** Сводка: когда ложатся или поднимаются сразу многие боты. */
export function alertSummaryText(
  events: AlertEvent[],
  o: { names: Map<string, string>; panelUrl: string },
): string {
  const line = (e: AlertEvent) => {
    const name = escapeHtml(o.names.get(e.botId) ?? e.botId);
    return e.kind === "down"
      ? `🔴 ${name}${e.error ? ` — ${escapeHtml(e.error)}` : ""}`
      : `🟢 ${name} — простой ${formatDowntime(Date.parse(e.at) - Date.parse(e.since))}`;
  };
  const down = events.filter((e) => e.kind === "down");
  const up = events.filter((e) => e.kind === "up");
  return [
    down.length ? `<b>Не отвечают боты клиентов: ${down.length}</b>` : null,
    ...down.map(line),
    up.length ? `<b>Снова отвечают: ${up.length}</b>` : null,
    ...up.map(line),
    `<a href="${escapeHtml(o.panelUrl).replace(/"/g, "&quot;")}">Открыть список клиентов</a>`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── платформа: кроны, вебхук Zernio, аккаунты Instagram/WhatsApp ──── */

/**
 * Те же переходы «сбой → восстановился» (stepHealthAlerts), но не про бота,
 * а про платформу. Ключ события говорит, о чём оно:
 * `cron:<задача>`, `zernio:webhook`, `account:<bot_id>:<id аккаунта>`,
 * `inbound:<bot_id>` (у клиента перестали приходить сообщения),
 * `twin:<bot_id>:<канал>:<username>` (у страницы два живых подключения в Zernio).
 */
export type PlatformSubject =
  | { kind: "cron"; job: string }
  | { kind: "zernio_webhook" }
  | { kind: "account"; botId: string; accountId: string }
  | { kind: "inbound"; botId: string }
  | { kind: "twin"; botId: string; platform: string; username: string };

export function platformKey(s: PlatformSubject): string {
  if (s.kind === "cron") return `cron:${s.job}`;
  if (s.kind === "zernio_webhook") return "zernio:webhook";
  if (s.kind === "inbound") return `inbound:${s.botId}`;
  if (s.kind === "twin") return `twin:${s.botId}:${s.platform}:${s.username.toLowerCase()}`;
  return `account:${s.botId}:${s.accountId}`;
}

export function parsePlatformKey(key: string): PlatformSubject | null {
  if (key === "zernio:webhook") return { kind: "zernio_webhook" };
  const inbound = /^inbound:(.+)$/.exec(key);
  if (inbound) return { kind: "inbound", botId: inbound[1]! };
  const twin = /^twin:([^:]+):([^:]+):(.+)$/.exec(key);
  if (twin) return { kind: "twin", botId: twin[1]!, platform: twin[2]!, username: twin[3]! };
  const cron = /^cron:(.+)$/.exec(key);
  if (cron) return { kind: "cron", job: cron[1]! };
  const acc = /^account:([^:]+):(.+)$/.exec(key);
  if (acc) return { kind: "account", botId: acc[1]!, accountId: acc[2]! };
  return null;
}

/**
 * Крон в порядке, если последний запуск удался и был не раньше двух
 * интервалов назад. Ни одного запуска ещё не было — не проверяем: новая
 * задача или суточный крон сразу после выкладки не должны будить оператора
 * (страница кронов показывает и такие).
 */
export function cronProbe(c: {
  job: string;
  everyMin: number;
  stale: boolean;
  last: { at: string; ok: boolean; error: string | null } | null;
}): HealthProbe | null {
  if (!c.last) return null;
  const bot_id = platformKey({ kind: "cron", job: c.job });
  if (c.stale)
    return {
      bot_id,
      ok: false,
      error: `не запускался дольше ${formatDowntime(2 * c.everyMin * 60_000)}`,
    };
  if (!c.last.ok) return { bot_id, ok: false, error: c.last.error ?? "запуск упал" };
  return { bot_id, ok: true, error: null };
}

/** Сколько без входящих в Instagram/WhatsApp — уже сбой, а не тихий день. */
export const INBOUND_SILENCE_MS = 24 * 60 * 60 * 1000;
/**
 * Клиент считается живым, если за неделю до тишины ему написали хотя бы
 * столько раз: у BOVI 5–30 сообщений в день, а клиент, которому пишут раз в
 * неделю, сутками молчит и без поломки.
 */
export const INBOUND_ACTIVE_MIN = 10;

/**
 * Входящие клиента в Zernio. BOVI 07.10: Instagram переподключили, аккаунт
 * в Zernio не считался отвязанным, а сообщения трое суток не доходили —
 * узнали по журналу. Теперь сутки тишины у клиента, которому обычно пишут, —
 * сбой для оператора. Не было ни одного входящего — не проверяем.
 */
export function inboundProbe(s: {
  botId: string;
  /** Последнее входящее (ISO) или null. */
  last: string | null;
  /** Входящих за неделю до последнего (включая его). */
  weekBefore: number;
  now: number;
}): HealthProbe | null {
  if (!s.last) return null;
  const bot_id = platformKey({ kind: "inbound", botId: s.botId });
  const quiet = s.now - Date.parse(s.last);
  if (!(quiet >= INBOUND_SILENCE_MS) || s.weekBefore < INBOUND_ACTIVE_MIN)
    return { bot_id, ok: true, error: null };
  return { bot_id, ok: false, error: `нет входящих ${formatDowntime(quiet)}` };
}

/** Вебхук Zernio v2: сбой чтения или запись, которую нужно обновить кнопкой «Привязать». */
export function zernioWebhookProbe(s: {
  ok: boolean;
  action: string;
  error?: string;
}): HealthProbe {
  const bot_id = platformKey({ kind: "zernio_webhook" });
  if (s.ok) return { bot_id, ok: true, error: null };
  const need: Record<string, string> = {
    create: "вебхука v2 нет",
    update: "вебхук v2 выключен или не видит профили клиентов v2",
    disable: "вебхук v2 включён, а клиентов v2 с Zernio нет",
  };
  return { bot_id, ok: false, error: s.error || need[s.action] || s.action };
}

type PlatformTextOptions = {
  /** Подпись по ключу: название крона, «Instagram @x клиента «Имя»». */
  labels: Map<string, string>;
  base: string;
  timeZone: string;
};

function platformLink(key: string, base: string): string {
  const s = parsePlatformKey(key);
  const [href, title] =
    s?.kind === "cron"
      ? [`${base}/operator/crons`, "Открыть кроны"]
      : s?.kind === "zernio_webhook"
        ? [`${base}/operator/settings`, "Открыть настройки платформы"]
        : s?.kind === "account" || s?.kind === "inbound" || s?.kind === "twin"
          ? [`${base}/operator/clients/${s.botId}`, "Открыть клиента в панели"]
          : [`${base}/operator`, "Открыть панель"];
  return `<a href="${escapeHtml(href).replace(/"/g, "&quot;")}">${title}</a>`;
}

function platformTitle(e: AlertEvent, label: string): string {
  const s = parsePlatformKey(e.botId);
  const down = e.kind === "down";
  if (s?.kind === "cron") return `Крон «${label}» ${down ? "не работает" : "снова работает"}`;
  if (s?.kind === "zernio_webhook")
    return down ? "Вебхук Zernio v2 не в порядке" : "Вебхук Zernio v2 снова в порядке";
  if (s?.kind === "inbound")
    return `${label}: ${down ? "сутки нет входящих сообщений" : "входящие снова идут"}`;
  if (s?.kind === "twin")
    return `${label}: ${down ? "два подключения в Zernio" : "в Zernio снова одно подключение"}`;
  return `${label} ${down ? "отключился" : "снова подключён"}`;
}

/** Текст сообщения оператору о платформе (HTML Telegram). */
export function platformAlertText(e: AlertEvent, o: PlatformTextOptions): string {
  const label = escapeHtml(o.labels.get(e.botId) ?? e.botId);
  const s = parsePlatformKey(e.botId);
  const hint =
    e.kind === "down"
      ? s?.kind === "zernio_webhook"
        ? "События Instagram и WhatsApp клиентов v2 не доходят. Нажмите «Привязать» в карточке «Вебхук Zernio»."
        : s?.kind === "account"
          ? "Бот в этом канале не видит сообщений. Продавцу ушло уведомление, аккаунт нужно подключить заново."
          : s?.kind === "inbound"
            ? "Обычно клиенту пишут каждый день. Проверьте подключение Instagram/WhatsApp в Zernio и напишите в директ клиента с другого аккаунта: так 07.10 у BOVI трое суток терялись сообщения."
            : s?.kind === "twin"
              ? "Страницу переподключили, а старое подключение в Zernio не отвязалось. Сообщения могут приходить только на одно из них. Оставьте в Zernio одно подключение и напишите клиенту в директ с другого аккаунта."
              : null
      : null;
  if (e.kind === "down")
    return [
      `🔴 <b>${platformTitle(e, label)}</b>`,
      `С ${formatTime(e.since, o.timeZone)}.`,
      e.error ? `Причина: ${escapeHtml(e.error)}` : null,
      hint,
      platformLink(e.botId, o.base),
    ]
      .filter(Boolean)
      .join("\n");
  return [
    `🟢 <b>${platformTitle(e, label)}</b>`,
    `Простой: ${formatDowntime(Date.parse(e.at) - Date.parse(e.since))}.`,
    platformLink(e.botId, o.base),
  ].join("\n");
}

/** Сводка по платформе, когда событий много за один прогон. */
export function platformSummaryText(
  events: AlertEvent[],
  o: { labels: Map<string, string>; base: string },
): string {
  const line = (e: AlertEvent) => {
    const title = platformTitle(e, escapeHtml(o.labels.get(e.botId) ?? e.botId));
    return e.kind === "down"
      ? `🔴 ${title}${e.error ? ` — ${escapeHtml(e.error)}` : ""}`
      : `🟢 ${title}`;
  };
  return [
    `<b>Платформа: сбоев ${events.filter((e) => e.kind === "down").length}, восстановлено ${events.filter((e) => e.kind === "up").length}</b>`,
    ...events.map(line),
    `<a href="${escapeHtml(`${o.base}/operator/crons`).replace(/"/g, "&quot;")}">Открыть кроны</a>`,
  ].join("\n");
}

/**
 * Разовое сообщение оператору: клиент переподключил Instagram/WhatsApp в
 * Zernio, у аккаунта новый id. Новый id уже записан клиенту (сверка
 * аккаунтов), но 07.10 у BOVI после переподключения трое суток не доходили
 * сообщения, и узнали мы по тишине. Теперь — сразу.
 */
export function reconnectAlertText(
  r: {
    platform: string;
    username?: string;
    name?: string;
    oldId: string;
    newId: string;
    oldStillLive: boolean;
  },
  o: { clientName: string; botId: string; base: string },
): string {
  const channel =
    r.platform === "whatsapp" ? "WhatsApp" : r.platform === "instagram" ? "Instagram" : r.platform;
  const who = r.username ? ` @${r.username}` : r.name ? ` «${r.name}»` : "";
  const href = `${o.base}/operator/clients/${o.botId}`;
  return [
    `🔄 <b>${escapeHtml(`${channel}${who}`)} клиента «${escapeHtml(o.clientName)}» переподключён в Zernio</b>`,
    `Новый id ${escapeHtml(r.newId)} привязан к клиенту автоматически, прежний — ${escapeHtml(r.oldId)}.`,
    r.oldStillLive
      ? "Прежнее подключение в Zernio тоже живо: оставьте одно, сообщения могут приходить только на одно из них."
      : "Прежнего подключения в Zernio больше нет.",
    "Проверьте приём: напишите клиенту в директ с другого аккаунта и посмотрите журнал.",
    `<a href="${escapeHtml(href).replace(/"/g, "&quot;")}">Открыть клиента в панели</a>`,
  ].join("\n");
}
