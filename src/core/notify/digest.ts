import { adminT } from "@/app/i18n/admin";
import type { Locale } from "@/core/i18n/locale";
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { getSetting, setSetting, updateSettingAtomic } from "@/core/settings/settings";
import { minutesInTz, type NotifyKind, type NotifyPrefs } from "./prefs";

/**
 * Дайджест продавцу: уведомления, отложенные тихими часами, плюс сводка за
 * сутки — раз в день в выбранный час по поясу магазина. Отложенные строки
 * лежат в `zernio_logs` (`event_id = digest:<uuid>`, `status = queued`), как
 * и остальные журналы арендатора: своей таблицы нет.
 */
export const DIGEST_PREFIX = "digest:";
const SENT_KEY = "notify_digest_sent_on";

export async function deferToDigest(
  ctx: TenantContext,
  kind: NotifyKind,
  text: string,
): Promise<void> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `${DIGEST_PREFIX}${crypto.randomUUID()}`,
    event_type: `digest.${kind}`,
    status: "queued",
    payload: { text: text.slice(0, 2000), kind } as Json,
  });
  if (error) console.warn(`[notify] дайджест: не отложено (${kind}): ${error.message}`);
}

export type DigestItem = { id: string; kind: string; text: string; at: string };

/**
 * Все отложенные пункты, постранично и в стабильном порядке (время, затем id):
 * ничего не теряется на «первых 100». Ошибка чтения — исключение, а не «пусто»:
 * иначе дайджест ушёл бы без пунктов, а день был бы занят.
 */
export async function queuedDigestItems(ctx: TenantContext): Promise<DigestItem[]> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, event_type, payload, created_at")
        .like("event_id", `${DIGEST_PREFIX}%`)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "Дайджест: чтение отложенного",
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.event_type.replace(/^digest\./, ""),
    text: String((r.payload as { text?: string } | null)?.text ?? ""),
    at: r.created_at,
  }));
}

/**
 * Пометить пункты отправленными (пачками по 200, только ещё стоящие в очереди).
 * Возвращает, сколько пачек не записалось: сообщение уже ушло, поэтому ошибка не
 * бросается — вызывающий повторит и, если не вышло, запишет в журнал.
 */
export async function markDigested(ctx: TenantContext, ids: string[]): Promise<number> {
  let failed = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await ctx.db
      .from("zernio_logs")
      .update({ status: "processed" })
      .in("id", ids.slice(i, i + 200))
      .eq("status", "queued");
    if (error) failed += 1;
  }
  return failed;
}

export type DigestStats = {
  ordersYesterday: number;
  revenueYesterday: { total: number; currency: string };
  awaitingConfirmation: number;
  undelivered: number;
};

const DIGEST_TEXT = {
  ru: {
    title: (d: string) => `☀️ <b>Сводка за ${d}</b>`,
    orders: (n: number) => `Заказов: ${n}`,
    revenue: (sum: string) => ` на ${sum}`,
    awaiting: (n: number) => `Ждут подтверждения: ${n}`,
    undelivered: (n: number, section: string) =>
      `Не доставлено сообщений: ${n} — см. «${section}» в панели`,
    night: (n: number) => `<b>За ночь (${n}):</b>`,
    more: (n: number) => `… и ещё ${n}`,
  },
  kk: {
    title: (d: string) => `☀️ <b>${d} бойынша жиынтық</b>`,
    orders: (n: number) => `Тапсырыс: ${n}`,
    revenue: (sum: string) => `, сомасы ${sum}`,
    awaiting: (n: number) => `Растауды күтуде: ${n}`,
    undelivered: (n: number, section: string) =>
      `Жеткізілмеген хабарлама: ${n} — панельдегі «${section}» бөлімін қараңыз`,
    night: (n: number) => `<b>Түнде (${n}):</b>`,
    more: (n: number) => `… және тағы ${n}`,
  },
  en: {
    title: (d: string) => `☀️ <b>Summary for ${d}</b>`,
    orders: (n: number) => `Orders: ${n}`,
    revenue: (sum: string) => ` totalling ${sum}`,
    awaiting: (n: number) => `Awaiting confirmation: ${n}`,
    undelivered: (n: number, section: string) =>
      `Undelivered messages: ${n} — see "${section}" in the panel`,
    night: (n: number) => `<b>Overnight (${n}):</b>`,
    more: (n: number) => `… and ${n} more`,
  },
  uz: {
    title: (d: string) => `☀️ <b>${d} uchun xulosa</b>`,
    orders: (n: number) => `Buyurtmalar: ${n}`,
    revenue: (sum: string) => `, jami ${sum}`,
    awaiting: (n: number) => `Tasdiqlashni kutmoqda: ${n}`,
    undelivered: (n: number, section: string) =>
      `Yetkazilmagan xabarlar: ${n} — paneldagi «${section}» boʻlimiga qarang`,
    night: (n: number) => `<b>Kechasi (${n}):</b>`,
    more: (n: number) => `… va yana ${n} ta`,
  },
} as const;

/** Текст сводки — чистая часть, чтобы проверять без базы. Язык — продавца, по умолчанию русский. */
export function renderDigest(
  dateLabel: string,
  stats: DigestStats,
  items: readonly DigestItem[],
  locale: Locale = "ru",
): string {
  const t = DIGEST_TEXT[locale];
  const lines = [
    t.title(dateLabel),
    "",
    t.orders(stats.ordersYesterday) +
      (stats.ordersYesterday
        ? t.revenue(`${stats.revenueYesterday.total} ${stats.revenueYesterday.currency}`)
        : ""),
    t.awaiting(stats.awaitingConfirmation),
  ];
  if (stats.undelivered)
    lines.push(t.undelivered(stats.undelivered, adminT(locale)("outbox.title")));
  if (items.length) {
    lines.push("", t.night(items.length));
    for (const it of items.slice(0, 20)) lines.push(`• ${it.text.split("\n")[0]!.slice(0, 200)}`);
    if (items.length > 20) lines.push(t.more(items.length - 20));
  }
  return lines.join("\n");
}

/** Пора ли слать дайджест: нужный час по поясу и сегодня ещё не слали. */
export function digestDue(
  prefs: NotifyPrefs,
  now: Date,
  tz: string,
  sentOn: string | null,
  today: string,
): boolean {
  if (!prefs.digest.enabled) return false;
  if (sentOn === today) return false;
  const minutes = minutesInTz(now, tz);
  return Math.floor(minutes / 60) === prefs.digest.hour;
}

export async function digestSentOn(ctx: TenantContext): Promise<string | null> {
  return getSetting(ctx, SENT_KEY);
}

export async function markDigestSent(ctx: TenantContext, today: string): Promise<void> {
  await setSetting(ctx, SENT_KEY, today);
}

/**
 * Занять сегодняшний дайджест ДО отправки условной записью (сравнение с
 * прочитанной отметкой): из двух кронов, дошедших до магазина в одно время,
 * шлёт тот, чья запись прошла. `prev` — отметка до нас, чтобы вернуть её,
 * если отправка сорвалась (`releaseDigest`) и следующий тик повторил.
 */
export async function claimDigestSent(
  ctx: TenantContext,
  today: string,
): Promise<{ won: boolean; prev: string | null }> {
  let prev: string | null = null;
  const r = await updateSettingAtomic(ctx, SENT_KEY, (raw) => {
    prev = raw;
    return raw === today ? null : today;
  });
  return { won: r === "written", prev };
}

/** Отправка сорвалась — вернуть прежнюю отметку, только если она всё ещё наша. */
export async function releaseDigest(
  ctx: TenantContext,
  today: string,
  prev: string | null,
): Promise<void> {
  await updateSettingAtomic(ctx, SENT_KEY, (raw) => (raw === today ? (prev ?? "") : null));
}
