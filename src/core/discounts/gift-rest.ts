import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { generateGiftCode } from "./pure";

/**
 * Остаток сертификата: сертификат на 10 000 на заказе в 3 000 не сгорает —
 * покупатель получает новый код на 7 000 в той же валюте (решение владельца
 * 27.09). Связь с заказом — метка `gift_rest:<заказ>` в app_settings
 * (схема не меняется): при отмене неоплаченного заказа остаток гасится, а
 * исходный сертификат возвращается (returnOrderCodes).
 */
export const GIFT_REST_PREFIX = "gift_rest:";

export type GiftRest = { code: string; amount: number; currency: string };

function parseRest(raw: string | null | undefined): GiftRest | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GiftRest>;
    return typeof v.code === "string" && Number(v.amount) > 0 && typeof v.currency === "string"
      ? { code: v.code, amount: Number(v.amount), currency: v.currency }
      : null;
  } catch {
    return null;
  }
}

/** Остаток, выданный по заказу; null — не выдавался. */
export async function giftRestOf(ctx: TenantContext, orderId: number): Promise<GiftRest | null> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("bot_id", ctx.tenant.id)
    .eq("key", `${GIFT_REST_PREFIX}${orderId}`)
    .maybeSingle();
  if (error) throw serverFailure(`[gift] остаток заказа ${orderId}: ${error.message}`);
  return parseRest(data?.value);
}

/**
 * Выдать остаток по заказу: сначала метка (одна на заказ), потом сертификат
 * под её кодом. Код занят чужим сертификатом — новый кандидат. Сумма до
 * копеек; 0 и меньше — остатка нет.
 */
export async function issueGiftRest(
  ctx: TenantContext,
  p: { orderId: number; orderNo: number; sourceCode: string; rest: number; currency: string },
  gen: () => string = generateGiftCode,
): Promise<GiftRest | null> {
  const amount = Math.round(p.rest * 100) / 100;
  if (!(amount > 0)) return null;
  const key = `${GIFT_REST_PREFIX}${p.orderId}`;
  const before = await giftRestOf(ctx, p.orderId);
  if (before) return before;
  for (let attempt = 0; attempt < 5; attempt++) {
    const rest: GiftRest = { code: gen(), amount, currency: p.currency };
    const taken = await ctx.db
      .from("gift_certificates")
      .select("id")
      .eq("bot_id", ctx.tenant.id)
      .eq("code", rest.code)
      .maybeSingle();
    if (taken.error)
      throw serverFailure(`[gift] остаток заказа ${p.orderId}: ${taken.error.message}`);
    if (taken.data) continue;
    const mark = await ctx.db.from("app_settings").insert({
      bot_id: ctx.tenant.id,
      key,
      value: JSON.stringify(rest),
      updated_at: new Date().toISOString(),
    });
    if (mark.error) {
      if (mark.error.code === "23505") return giftRestOf(ctx, p.orderId);
      throw serverFailure(`[gift] метка остатка заказа ${p.orderId}: ${mark.error.message}`);
    }
    const { error } = await ctx.db.from("gift_certificates").insert({
      bot_id: ctx.tenant.id,
      code: rest.code,
      amount,
      currency: p.currency,
      note: `Остаток от ${p.sourceCode}, заказ №${p.orderNo}`,
      status: "active",
    });
    if (error) {
      // Метка без сертификата: снять, чтобы следующая попытка взяла новый код.
      await ctx.db.from("app_settings").delete().eq("bot_id", ctx.tenant.id).eq("key", key);
      if (error.code === "23505") continue;
      throw serverFailure(`[gift] остаток заказа ${p.orderId}: ${error.message}`);
    }
    return rest;
  }
  return null;
}

/**
 * Погасить остаток отменённого заказа: только пока им не воспользовались
 * (active → cancelled условной записью). true — остатка не было или он
 * погашен; false — остаток уже потрачен, исходный сертификат не возвращаем.
 */
export async function voidGiftRest(ctx: TenantContext, orderId: number): Promise<boolean> {
  const rest = await giftRestOf(ctx, orderId);
  if (!rest) return true;
  const { data, error } = await ctx.db
    .from("gift_certificates")
    .update({ status: "cancelled" })
    .eq("bot_id", ctx.tenant.id)
    .eq("code", rest.code)
    .in("status", ["active", "cancelled"])
    .select("id");
  if (error) throw serverFailure(`[gift] остаток заказа ${orderId}: ${error.message}`);
  // Сертификата под меткой нет (вставка не прошла) — гасить нечего.
  if (!data?.length) {
    const { data: exists } = await ctx.db
      .from("gift_certificates")
      .select("id")
      .eq("bot_id", ctx.tenant.id)
      .eq("code", rest.code)
      .maybeSingle();
    return !exists;
  }
  return true;
}
