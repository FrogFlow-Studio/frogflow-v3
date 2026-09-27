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
