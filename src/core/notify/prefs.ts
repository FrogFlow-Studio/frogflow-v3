import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";

/**
 * Что и куда получает продавец: матрица «событие → канал» (Telegram, почта),
 * тихие часы и утренний дайджест. Хранится в app_settings.notify_prefs
 * (JSON). Срочное — заказ, чек, жалоба на оплату, сбой выдачи — тихие часы
 * не задерживают: покупатель ждёт, а продавец сам решит, смотреть ли ночью.
 * Остальное в тихие часы уходит в дайджест.
 */
export const NOTIFY_KINDS = [
  "new_order",
  "delivery_failure",
  "complaint",
  "question",
  "native_cart",
  "account",
  "fulfillment",
  "system",
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Не ждут тихих часов. */
export const URGENT_KINDS: readonly NotifyKind[] = ["new_order", "delivery_failure", "complaint"];

export type NotifyChannels = { telegram: boolean; email: boolean };
export type NotifyPrefs = {
  kinds: Record<NotifyKind, NotifyChannels>;
  /** Почта продавца для канала «почта». */
  email: string;
  /** Тихие часы «HH:MM»–«HH:MM» в поясе магазина; null — нет. */
  quiet: { from: string; to: string } | null;
  digest: { enabled: boolean; hour: number };
};

export const NOTIFY_PREFS_KEY = "notify_prefs";

export function defaultNotifyPrefs(): NotifyPrefs {
  const kinds = Object.fromEntries(
    NOTIFY_KINDS.map((k) => [k, { telegram: true, email: false }]),
  ) as Record<NotifyKind, NotifyChannels>;
  return { kinds, email: "", quiet: null, digest: { enabled: false, hour: 9 } };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseNotifyPrefs(raw: string | null | undefined): NotifyPrefs {
  const d = defaultNotifyPrefs();
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<NotifyPrefs>;
    if (p.kinds && typeof p.kinds === "object")
      for (const k of NOTIFY_KINDS) {
        const c = (p.kinds as Record<string, Partial<NotifyChannels> | undefined>)[k];
        if (c) d.kinds[k] = { telegram: c.telegram !== false, email: c.email === true };
      }
    if (typeof p.email === "string") d.email = p.email.trim();
    if (p.quiet && TIME.test(p.quiet.from ?? "") && TIME.test(p.quiet.to ?? ""))
      d.quiet = { from: p.quiet.from, to: p.quiet.to };
    if (p.digest && typeof p.digest === "object") {
      const hour = Number(p.digest.hour);
      d.digest = {
        enabled: p.digest.enabled === true,
        hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 9,
      };
    }
  } catch {
    /* битое значение — по умолчанию */
  }
  return d;
}

/** Минуты с полуночи в поясе магазина. */
export function minutesInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Сейчас тихие часы? Интервал через полночь («22:00»–«08:00») тоже понимается. */
export function inQuietHours(prefs: NotifyPrefs, now: Date, tz: string): boolean {
  if (!prefs.quiet) return false;
  const from = toMinutes(prefs.quiet.from);
  const to = toMinutes(prefs.quiet.to);
  if (from === to) return false;
  const cur = minutesInTz(now, tz);
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

export type Decision = { telegram: boolean; email: boolean; defer: boolean };

/** Срочные виды, у которых выключен Telegram: «только почта» для них сохранить нельзя. */
export function urgentWithoutTelegram(kinds: Record<string, NotifyChannels>): NotifyKind[] {
  return URGENT_KINDS.filter((k) => kinds[k] && !kinds[k]!.telegram);
}

/**
 * Куда сейчас уходит уведомление вида `kind`: в каналы сразу или в дайджест.
 * `mailReady` — настроена ли почта платформы (SMTP). Без неё почта не канал:
 * срочное всегда идёт и в Telegram, а несрочное, выбранное «только почтой»,
 * тоже падает в Telegram — иначе продавец его не получит.
 */
export function decideDelivery(
  prefs: NotifyPrefs,
  kind: NotifyKind,
  now: Date,
  tz: string,
  mailReady = true,
): Decision {
  const ch = prefs.kinds[kind] ?? { telegram: true, email: false };
  const wantsEmail = ch.email && Boolean(prefs.email);
  const email = wantsEmail && mailReady;
  const urgent = URGENT_KINDS.includes(kind);
  const telegram = ch.telegram || urgent || (wantsEmail && !email);
  if (!telegram && !email) return { telegram: false, email: false, defer: false };
  if (inQuietHours(prefs, now, tz) && !urgent)
    return { telegram: false, email: false, defer: true };
  return { telegram, email, defer: false };
}

/** Сопоставление старых свободных «kind» из вызовов с матрицей. */
export function notifyKindOf(raw: string | undefined): NotifyKind {
  switch (raw) {
    case "new_order":
    case "proof":
      return "new_order";
    case "delivery_failure":
      return "delivery_failure";
    case "complaint":
      return "complaint";
    // homework — ученик сдал домашнее задание и ждёт ответа преподавателя, как вопрос.
    case "question":
    case "handoff":
    case "lead":
    case "homework":
      return "question";
    case "native_cart":
      return "native_cart";
    case "account":
    case "account_disconnected":
      return "account";
    case "fulfillment":
      return "fulfillment";
    default:
      return "system";
  }
}

/**
 * Матрица, почта, тихие часы и дайджест — модуль notify_in_bot. Без него всё
 * уходит в Telegram сразу, как в базовом пакете; сохранённые настройки не
 * стираются и вернутся, когда модуль снова включат.
 */
export async function loadNotifyPrefs(ctx: TenantContext): Promise<NotifyPrefs> {
  if (!ctx.tenant.modules.notify_in_bot) return defaultNotifyPrefs();
  return parseNotifyPrefs(await getSetting(ctx, NOTIFY_PREFS_KEY));
}

export async function saveNotifyPrefs(ctx: TenantContext, prefs: NotifyPrefs): Promise<void> {
  await setSetting(ctx, NOTIFY_PREFS_KEY, JSON.stringify(prefs));
}
