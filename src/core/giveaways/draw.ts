import { randomBytes } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { blockedAmong } from "@/core/customers/customers";
import { adminRecipients } from "@/core/notify/recipients";
import { updateSettingStamped } from "@/core/settings/settings";
import { eachPage } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { ENTRY_EVENT, entryPrefix, type MembershipCheck, type Participant } from "./entry";
import {
  getGiveaway,
  giveawayKey,
  parseGiveaway,
  type Giveaway,
  type GiveawayResult,
  type GiveawayWinner,
} from "./giveaway";
import { sha256Hex } from "@/lib/hash";

/**
 * Честный выбор победителей. Участники — события `giveaway.entry`; из них
 * убираются заблокированные, сотрудники и (если в условиях подписка на канал)
 * отписавшиеся. Место каждого допущенного определяет sha256(зерно + ":" +
 * ключ), победители — первые N по возрастанию. Зерно и хеш списка пишутся в
 * итог, поэтому выбор воспроизводится без доверия к продавцу, а смещения «по
 * остатку» нет. Итог пишется один раз условной записью по статусу: два
 * одновременных «Выбрать» дают одних победителей.
 */
export const REROLL_REASON_MIN = 3;
export const REROLL_REASON_MAX = 200;

const sha = (s: string) => sha256Hex(s);

/** Хеш допущенного списка: ключи по алфавиту, по одному в строке. */
export function listHash(userKeys: readonly string[]): string {
  return sha([...userKeys].sort().join("\n"));
}

/** Ключи по месту в выборе при этом зерне: первый — победитель №1. */
export function rankKeys(seed: string, userKeys: readonly string[]): string[] {
  return userKeys
    .map((k) => ({ k, h: sha(`${seed}:${k}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((x) => x.k);
}

/** Все участники розыгрыша постранично, порядок — по id (уникальный ключ). */
export async function listParticipants(
  ctx: TenantContext,
  giveawayId: string,
): Promise<Participant[]> {
  const out: Participant[] = [];
  await eachPage(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .eq("event_type", ENTRY_EVENT)
        .like("event_id", `${entryPrefix(giveawayId)}%`)
        .order("id", { ascending: true })
        .range(from, to),
    "Розыгрыш: участники",
    (rows) => {
      for (const r of rows) {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        if (typeof p.user_key !== "string") continue;
        out.push({
          userKey: p.user_key,
          telegramId: typeof p.telegram_id === "number" ? p.telegram_id : null,
          channel: p.channel === "instagram" ? "instagram" : "telegram",
        });
      }
    },
  );
  return out;
}

/** Telegram id сотрудников: продавцы магазина и кураторы школы. */
async function staffTelegramIds(ctx: TenantContext): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const v of await adminRecipients(ctx)) {
    const n = Number(v);
    if (Number.isFinite(n)) ids.add(n);
  }
  for (const c of ctx.tenant.settings.curators?.items ?? []) {
    if (c.telegram_id) ids.add(c.telegram_id);
  }
  return ids;
}

/**
 * Допущенные к выбору. Подписка проверяется заново: кто отписался после
 * участия, не выигрывает. Не удалось проверить — `serverFailure` (выбор
 * не делаем вслепую, повторим позже).
 */
export async function eligibleParticipants(
  ctx: TenantContext,
  g: Giveaway,
  isMember: MembershipCheck | null,
): Promise<{ entered: number; eligible: Participant[] }> {
  const all = await listParticipants(ctx, g.id);
  const tgIds = all.flatMap((p) => (p.telegramId ? [p.telegramId] : []));
  const blocked = g.excludeBlocked ? await blockedAmong(ctx, tgIds) : new Set<number>();
  const staff = g.excludeStaff ? await staffTelegramIds(ctx) : new Set<number>();
  const eligible: Participant[] = [];
  for (const p of all) {
    if (p.telegramId && (blocked.has(p.telegramId) || staff.has(p.telegramId))) continue;
    if (g.subscribeChannel && p.telegramId) {
      if (!isMember) throw serverFailure("Розыгрыш: нечем проверить подписку на канал");
      const m = await isMember(g.subscribeChannel, p.telegramId);
      if (m === null) throw serverFailure("Розыгрыш: подписка на канал не проверилась");
      if (!m) continue;
    }
    eligible.push(p);
  }
  return { entered: all.length, eligible };
}

const toWinner = (p: Participant): GiveawayWinner => ({
  userKey: p.userKey,
  telegramId: p.telegramId,
  channel: p.channel,
});

export type DrawOutcome = { giveaway: Giveaway; result: GiveawayResult; fresh: boolean };

/**
 * Выбрать победителей. Приём должен быть закрыт (вручную или по сроку).
 * Уже выбранный розыгрыш возвращается как есть (`fresh: false`) — повтор
 * победителей не меняет. Допущенных меньше, чем мест, — выигрывают все;
 * никого — итог пустой, это честный результат.
 */
export async function drawWinners(
  ctx: TenantContext,
  id: string,
  isMember: MembershipCheck | null = null,
  now = new Date(),
): Promise<DrawOutcome> {
  const g = await getGiveaway(ctx, id);
  if (!g) throw new UserError("err.giveaway.notFound", "Розыгрыш не найден.");
  if (g.status === "drawn" && g.result) return { giveaway: g, result: g.result, fresh: false };
  if (g.status === "open" && Date.parse(g.endsAt) > now.getTime())
    throw new UserError(
      "err.giveaway.stillOpen",
      "Приём ещё идёт: закройте его, потом выбирайте победителей.",
    );
  const { entered, eligible } = await eligibleParticipants(ctx, g, isMember);
  const seed = randomBytes(16).toString("hex");
  const keys = eligible.map((p) => p.userKey);
  const byKey = new Map(eligible.map((p) => [p.userKey, p]));
  const winners = rankKeys(seed, keys)
    .slice(0, g.winners)
    .map((k) => toWinner(byKey.get(k) as Participant));
  const result: GiveawayResult = {
    seed,
    listHash: listHash(keys),
    entered,
    eligible: eligible.length,
    drawnAt: now.toISOString(),
    winners,
    rerolls: [],
  };
  let won = false;
  const r = await updateSettingStamped(ctx, giveawayKey(id), (raw) => {
    // next() вызывается заново при каждой неудачной попытке записи — флаг сбрасываем.
    won = false;
    const cur = parseGiveaway(raw);
    if (!cur || cur.status === "drawn") return null;
    won = true;
    const next: Giveaway = {
      ...cur,
      status: "drawn",
      result,
      rev: cur.rev + 1,
      updatedAt: now.toISOString(),
    };
    return JSON.stringify(next);
  });
  if (r === "failed") throw serverFailure("Розыгрыш: итог не записался");
  const after = await getGiveaway(ctx, id);
  if (!after?.result) throw serverFailure("Розыгрыш: итог не прочитался после записи");
  return { giveaway: after, result: after.result, fresh: won };
}

/**
 * Заменить одного победителя следующим по рангу этого же зерна, кто ещё не
 * был ни победителем, ни заменённым. Причина обязательна и остаётся в
 * `rerolls`. Если победителя уже заменили в другом окне — отказ.
 */
export async function rerollWinner(
  ctx: TenantContext,
  id: string,
  userKey: string,
  reason: string,
  isMember: MembershipCheck | null = null,
  now = new Date(),
): Promise<{ giveaway: Giveaway; replacement: GiveawayWinner | null }> {
  const why = reason.trim();
  if (why.length < REROLL_REASON_MIN)
    throw new UserError("err.giveaway.rerollReason", "Укажите причину замены победителя.");
  if (why.length > REROLL_REASON_MAX)
    throw new UserError("err.giveaway.rerollReasonLong", "Причина — не длиннее {max} символов.", {
      max: REROLL_REASON_MAX,
    });
  const g = await getGiveaway(ctx, id);
  if (!g) throw new UserError("err.giveaway.notFound", "Розыгрыш не найден.");
  if (!g.result) throw new UserError("err.giveaway.notDrawn", "Победители ещё не выбраны.");
  const { eligible } = await eligibleParticipants(ctx, g, isMember);
  const byKey = new Map(eligible.map((p) => [p.userKey, p]));
  let stale = false;
  let replacement: GiveawayWinner | null = null;
  const r = await updateSettingStamped(ctx, giveawayKey(id), (raw) => {
    stale = false;
    const cur = parseGiveaway(raw);
    const res = cur?.result;
    const at = res ? res.winners.findIndex((w) => w.userKey === userKey) : -1;
    if (!cur || !res || at < 0) {
      stale = true;
      return null;
    }
    const used = new Set([
      ...res.winners.map((w) => w.userKey),
      ...res.rerolls.map((x) => x.replaced),
    ]);
    const nextKey = rankKeys(res.seed, [...byKey.keys()]).find((k) => !used.has(k));
    replacement = nextKey ? toWinner(byKey.get(nextKey) as Participant) : null;
    const rep = replacement;
    const winners = rep
      ? res.winners.map((w, i) => (i === at ? rep : w))
      : res.winners.filter((_, i) => i !== at);
    const rerolls = [
      ...res.rerolls,
      { at: now.toISOString(), replaced: userKey, by: rep?.userKey ?? "", reason: why },
    ];
    const next: Giveaway = {
      ...cur,
      result: { ...res, winners, rerolls },
      rev: cur.rev + 1,
      updatedAt: now.toISOString(),
    };
    return JSON.stringify(next);
  });
  if (r === "failed") throw serverFailure("Розыгрыш: замена не записалась");
  if (stale)
    throw new UserError(
      "err.giveaway.rerollStale",
      "Этого победителя уже заменили. Обновите страницу.",
    );
  const after = await getGiveaway(ctx, id);
  if (!after) throw serverFailure("Розыгрыш: не прочитался после замены");
  return { giveaway: after, replacement };
}

/** Проверка выбора со стороны: тот же алгоритм по зерну и списку. */
export function verifyDraw(result: GiveawayResult, eligibleKeys: readonly string[]) {
  return {
    hashMatches: listHash(eligibleKeys) === result.listHash,
    winners: rankKeys(result.seed, eligibleKeys).slice(0, result.winners.length),
  };
}
