import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { stateFromJson, type DialogState } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";

/**
 * Общий потолок маркетинговых автосообщений на покупателя: напоминание о
 * корзине, «похожие материалы», возврат клиентов и автоворонка шлют каждое по
 * своему расписанию, и без общего счёта человек получал бы 3–4 сообщения в
 * день. По умолчанию — одно в сутки (скользящие 24 часа), продавец меняет в
 * «Рассылках»; «0» — без потолка. Служебные сообщения (оплата, заказ) сюда
 * не ходят.
 *
 * Метка — bot_users.state.last_marketing_at (плюс времена за сутки для
 * потолка больше одного). Ставится условной записью ДО отправки: из двух
 * кронов, дошедших до одного покупателя, отправит тот, чья запись прошла.
 * Отправитель после этого пишет state поверх возвращённого (с меткой),
 * иначе метка пропадёт.
 */
export const MARKETING_CAP_KEY = "marketing_daily_cap";
export const DEFAULT_MARKETING_CAP = 1;
export const MARKETING_CAP_MAX = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Пусто или мусор — по умолчанию (одно в сутки); «0» — без потолка. */
export function parseMarketingCap(raw: string | null | undefined): number {
  const s = (raw ?? "").trim();
  if (!/^\d+$/.test(s)) return DEFAULT_MARKETING_CAP;
  return Math.min(Number(s), MARKETING_CAP_MAX);
}

export async function loadMarketingCap(ctx: TenantContext): Promise<number> {
  return parseMarketingCap(await getSetting(ctx, MARKETING_CAP_KEY));
}

/** Времена маркетинговых сообщений за последние сутки (по метке в state). */
export function recentMarketing(state: DialogState, now: Date): string[] {
  const raw = state.marketing_times;
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  const last = typeof state.last_marketing_at === "string" ? state.last_marketing_at : null;
  if (last && !list.includes(last)) list.push(last);
  return list.filter((t) => {
    const at = Date.parse(t);
    return Number.isFinite(at) && now.getTime() - at < DAY_MS;
  });
}

export function marketingAllowed(state: DialogState, cap: number, now: Date): boolean {
  return cap <= 0 || recentMarketing(state, now).length < cap;
}

/**
 * Занять место под маркетинговое сообщение. `raw` — state строки, как её
 * прочитал отправитель. Запись условная по коротким полям: метка
 * last_marketing_at та же (соседний крон, успевший раньше, выигрывает) и
 * шаг диалога тот же (метка не затрёт оформление заказа). Весь state в
 * условие не кладём: он уходит в адрес запроса, и у длинного state
 * PostgREST отвечает 431. Вернёт state с новой меткой — отправлять можно;
 * null — потолок достигнут, state успел измениться или запись не прошла
 * (попробуем в следующий прогон; сбой записи — в лог).
 */
export async function claimMarketing(
  ctx: TenantContext,
  userKey: string,
  raw: Json | null | undefined,
  cap: number,
  now: Date,
): Promise<DialogState | null> {
  const state = stateFromJson(raw);
  if (cap <= 0) return state;
  if (!marketingAllowed(state, cap, now)) return null;
  const at = now.toISOString();
  const next: DialogState = {
    ...state,
    last_marketing_at: at,
    marketing_times: [...recentMarketing(state, now), at],
  };
  const base = ctx.db
    .from("bot_users")
    .update({ state: next as Json })
    .eq("user_key", userKey);
  const last = typeof state.last_marketing_at === "string" ? state.last_marketing_at : null;
  const byLast =
    last == null
      ? base.is("state->>last_marketing_at", null)
      : base.eq("state->>last_marketing_at", last);
  const mode = typeof state.mode === "string" && state.mode ? state.mode : null;
  const { data, error } = await (
    mode == null ? byLast.is("state->>mode", null) : byLast.eq("state->>mode", mode)
  ).select("user_key");
  if (error) {
    console.error(`[marketing-cap:${ctx.tenant.id}] ${userKey}: ${error.message}`);
    return null;
  }
  return data?.length ? next : null;
}
