import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/** Не больше за одну правку: опечатка в лишнем нуле не должна стоить магазину миллионы. */
export const MAX_POINTS_ADJUST = 1_000_000;
export const ADJUST_REASON_MIN = 3;
/** Ровно столько журнал действий показывает целиком (core/audit/admin-audit, MAX_TEXT). */
export const ADJUST_REASON_MAX = 120;
const ATTEMPTS = 5;

export type AdjustResult =
  | { ok: true; before: number; after: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "negative"; points: number }
  | { ok: false; reason: "busy" };

/**
 * Ручная правка баллов продавцом (компенсация, ошибка начисления): начислить
 * (delta > 0) или списать (delta < 0), причина обязательна. Баллы общие с v1 и
 * ботом, поэтому пишем только дельтой — условным обновлением по текущему
 * значению (`loyalty_points` — маленькое поле), а не «установить число». Ниже
 * нуля не уходим. Запись в журнал действий делает прослойка админки
 * (src/start.ts) из имени функции и аргументов — с причиной и дельтой.
 */
export async function adjustCustomerPoints(
  ctx: TenantContext,
  userKey: string,
  delta: number,
  reason: string,
): Promise<AdjustResult> {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_POINTS_ADJUST)
    throw new RangeError("Правка баллов — целое ненулевое число в пределах лимита.");
  const why = reason.trim();
  if (why.length < ADJUST_REASON_MIN || why.length > ADJUST_REASON_MAX)
    throw new RangeError("Нужна причина правки баллов.");

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { data: u, error } = await ctx.db
      .from("bot_users")
      .select("loyalty_points")
      .eq("user_key", userKey)
      .maybeSingle();
    if (error) throw serverFailure(`Не удалось прочитать баланс баллов: ${error.message}`);
    if (!u) return { ok: false, reason: "not_found" };
    const before = u.loyalty_points == null ? null : Number(u.loyalty_points);
    const current = before ?? 0;
    if (current + delta < 0) return { ok: false, reason: "negative", points: current };
    const update = ctx.db
      .from("bot_users")
      .update({ loyalty_points: current + delta })
      .eq("user_key", userKey);
    const { data: done, error: writeError } = await (
      before == null ? update.is("loyalty_points", null) : update.eq("loyalty_points", before)
    )
      .select("user_key")
      .maybeSingle();
    if (writeError) throw serverFailure(`Не удалось записать баллы: ${writeError.message}`);
    if (done) return { ok: true, before: current, after: current + delta };
  }
  return { ok: false, reason: "busy" };
}
