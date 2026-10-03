import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
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

export async function queuedDigestItems(ctx: TenantContext, limit = 100): Promise<DigestItem[]> {
  const { data } = await ctx.db
    .from("zernio_logs")
    .select("id, event_type, payload, created_at")
    .like("event_id", `${DIGEST_PREFIX}%`)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.event_type.replace(/^digest\./, ""),
    text: String((r.payload as { text?: string } | null)?.text ?? ""),
    at: r.created_at,
  }));
}

export async function markDigested(ctx: TenantContext, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ctx.db.from("zernio_logs").update({ status: "processed" }).in("id", ids);
}

export type DigestStats = {
  ordersYesterday: number;
  revenueYesterday: { total: number; currency: string };
  awaitingConfirmation: number;
  undelivered: number;
};

/** Текст сводки — чистая часть, чтобы проверять без базы. */
export function renderDigest(
  dateLabel: string,
  stats: DigestStats,
  items: readonly DigestItem[],
): string {
  const lines = [
    `☀️ <b>Сводка за ${dateLabel}</b>`,
    "",
    `Заказов: ${stats.ordersYesterday}${
      stats.ordersYesterday
        ? ` на ${stats.revenueYesterday.total} ${stats.revenueYesterday.currency}`
        : ""
    }`,
    `Ждут подтверждения: ${stats.awaitingConfirmation}`,
  ];
  if (stats.undelivered)
    lines.push(`Не доставлено сообщений: ${stats.undelivered} — см. «Не доставлено» в панели`);
  if (items.length) {
    lines.push("", `<b>За ночь (${items.length}):</b>`);
    for (const it of items.slice(0, 20)) lines.push(`• ${it.text.split("\n")[0]!.slice(0, 200)}`);
    if (items.length > 20) lines.push(`… и ещё ${items.length - 20}`);
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
