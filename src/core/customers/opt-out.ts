import { serverFailure } from "@/lib/server-failure";
/**
 * Отписка покупателя от рассылок и прочих маркетинговых сообщений
 * (рассылки, напоминание о корзине, возврат клиентов, автоворонка).
 * Флаг — `bot_users.opt_out`, общий с v1: ставим и снимаем только по
 * действию самого покупателя, старые значения не пересчитываем.
 * Сообщения о заказе и оплате приходят и отписанным.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";

export type OptOutCommand = "unsubscribe" | "subscribe";

const UNSUBSCRIBE = new Set([
  "стоп",
  "stop",
  "/stop",
  "отписаться",
  "отписка",
  "отпишите",
  "отпишись",
  "unsubscribe",
  "тоқтату",
  "to'xtatish",
]);

const SUBSCRIBE = new Set(["подписаться", "подпишите", "subscribe", "жазылу", "obuna"]);

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?)»"«(]+/g, "")
    .replace(/\s+/g, " ");
}

/** Слово покупателя «стоп»/«отписаться» или «подписаться»; иначе null. */
export function optOutCommand(text: string | null | undefined): OptOutCommand | null {
  if (!text) return null;
  const t = normalize(text);
  if (UNSUBSCRIBE.has(t)) return "unsubscribe";
  if (SUBSCRIBE.has(t)) return "subscribe";
  return null;
}

/**
 * Когда слово — отписка: вне оформления. На шагах оформления «стоп» в Direct
 * отменяет оформление (channels/zernio/shop-flow isCancel), а после заказа
 * (ждём оплату или чек) оформление уже закончено.
 */
export function optOutWordsApply(mode: string | null | undefined): boolean {
  return !mode || mode === "idle" || mode === "awaiting_payment" || mode === "awaiting_proof";
}

/**
 * Отписать или вернуть покупателя. Условная запись: true — флаг изменён
 * этим вызовом, false — он уже был таким (или покупателя нет).
 */
export async function setOptOut(
  ctx: TenantContext,
  userKey: string,
  optOut: boolean,
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .update({ opt_out: optOut })
    .eq("user_key", userKey)
    .eq("opt_out", !optOut)
    .select("user_key")
    .maybeSingle();
  if (error) console.warn(`[opt-out] ${userKey}: ${error.message}`);
  return Boolean(data);
}

/** Отписан ли покупатель сейчас. */
export async function isOptedOut(ctx: TenantContext, userKey: string): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("bot_users")
    .select("opt_out")
    .eq("user_key", userKey)
    .maybeSingle();
  if (dataError) throw serverFailure(`Покупатели: отписка: ${dataError.message}`);
  return data?.opt_out === true;
}
