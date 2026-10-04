import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { isBlocked } from "@/core/customers/customers";
import { serverFailure } from "@/lib/server-failure";
import { getGiveaway, isAccepting, type Giveaway } from "./giveaway";

/**
 * Участие в розыгрыше: одно событие `giveaway.entry` в `zernio_logs` на
 * человека. event_id = `giveaway:<id>:entry:<ключ покупателя>` уникален в
 * базе, поэтому повтор (второй клик, два нажатия разом) не создаёт второго
 * участника — проигравший вставку получает «вы уже участвуете». Это учёт, а
 * не журнал вебхука: ретеншн такие строки не удаляет (core/retention).
 */
export const ENTRY_EVENT = "giveaway.entry";
export const entryEventId = (giveawayId: string, userKey: string) =>
  `giveaway:${giveawayId}:entry:${userKey}`;
export const entryPrefix = (giveawayId: string) => `giveaway:${giveawayId}:entry:`;

export type EntryOutcome =
  | { status: "entered"; giveaway: Giveaway }
  | { status: "already"; giveaway: Giveaway }
  | { status: "needSubscription"; giveaway: Giveaway }
  /** Telegram не ответил, подписку проверить не удалось: не участник, пусть попробует позже. */
  | { status: "checkFailed"; giveaway: Giveaway }
  | { status: "closed"; giveaway: Giveaway }
  | { status: "blocked"; giveaway: Giveaway }
  | { status: "notFound" };

/** true — подписан, false — нет, null — проверить не вышло. */
export type MembershipCheck = (channel: string, telegramId: number) => Promise<boolean | null>;

export type Participant = {
  userKey: string;
  telegramId: number | null;
  channel: "telegram" | "instagram";
  /** Что ещё помнить об участнике (ник, комментарий): кладётся в payload события. */
  extra?: Record<string, Json>;
};

export async function hasEntered(
  ctx: TenantContext,
  giveawayId: string,
  userKey: string,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_id", entryEventId(giveawayId, userKey))
    .maybeSingle();
  if (error) throw serverFailure(`Розыгрыш: участие не прочитано: ${error.message}`);
  return Boolean(data);
}

/** Записать участника. true — записал этот вызов, false — уже был (23505). */
export async function recordEntry(
  ctx: TenantContext,
  g: Giveaway,
  who: Participant,
  now: Date,
): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: entryEventId(g.id, who.userKey),
    event_type: ENTRY_EVENT,
    status: "event",
    payload: {
      giveaway_id: g.id,
      user_key: who.userKey,
      telegram_id: who.telegramId,
      channel: who.channel,
      at: now.toISOString(),
      ...who.extra,
    } as Json,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw serverFailure(`Розыгрыш: участник не записан: ${error.message}`);
}

/** Участие из Telegram (ссылка `?start=gw_<id>` и кнопка в рассылке). */
export async function enterFromTelegram(
  ctx: TenantContext,
  giveawayId: string,
  who: { userKey: string; telegramId: number },
  isMember: MembershipCheck,
  now = new Date(),
): Promise<EntryOutcome> {
  const g = await getGiveaway(ctx, giveawayId);
  if (!g || g.channel === "instagram") return { status: "notFound" };
  if (await isBlocked(ctx, who.telegramId)) return { status: "blocked", giveaway: g };
  // Повтор отвечаем «уже участвуете» и после закрытия приёма: участие остаётся в силе.
  if (await hasEntered(ctx, g.id, who.userKey)) return { status: "already", giveaway: g };
  if (!isAccepting(g, now)) return { status: "closed", giveaway: g };
  if (g.subscribeChannel) {
    const member = await isMember(g.subscribeChannel, who.telegramId);
    if (member === null) return { status: "checkFailed", giveaway: g };
    if (!member) return { status: "needSubscription", giveaway: g };
  }
  const won = await recordEntry(ctx, g, { ...who, channel: "telegram" }, now);
  return { status: won ? "entered" : "already", giveaway: g };
}
