import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingAtomic } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { localToInstant } from "./cohort";
import { CHANNEL_SLOT, CHAT_SLOT } from "./channel.server";
import { LOCAL_DAY_RE, courseKey, parseCourse } from "./course";
import { parseRun, purchaseTimeline, runKey, startRun, type CoursePurchase } from "./run.server";
import { readSetting } from "./db.server";

/**
 * Продление доступа вручную (компенсация, рассрочка): у тарифа со сроком
 * доступа продавец продлевает срок одному ученику до конца выбранного дня в
 * поясе магазина. Срок лежит в записи прохождения (`course_run_<позиция>.until`)
 * — её читают все, кто считает срок (`courseTimeline`: страница курса, бот,
 * крон окончания), поэтому продление учтено везде. Причина обязательна и
 * попадает в историю заказа. Если доступ уже закрыт кроном окончания срока,
 * отметка закрытия и «снято» у канала и чата сбрасываются: ссылка выдаётся
 * заново в «Мои курсы».
 */
export const EXTEND_REASON_MAX = 300;

export type ExtendResult =
  | { ok: true; until: string }
  | {
      ok: false;
      reason: "notFound" | "unlimited" | "badDay" | "noReason" | "notLater" | "changed";
    };

export async function extendStudentAccess(
  ctx: TenantContext,
  orderItemId: string,
  day: string,
  reason: string,
  actor = "admin",
  now = new Date(),
): Promise<ExtendResult> {
  const why = reason.trim().slice(0, EXTEND_REASON_MAX);
  if (!why) return { ok: false, reason: "noReason" };
  if (!LOCAL_DAY_RE.test(day)) return { ok: false, reason: "badDay" };
  const until = new Date(localToInstant(`${day}T23:59`, ctx.timezone).getTime() + 59_999);

  const { data: item, error } = await ctx.db
    .from("order_items")
    .select("id, order_id, product_id, product_variant_id, name_snapshot")
    .eq("id", orderItemId)
    .maybeSingle();
  if (error) throw serverFailure(`Покупка не прочитана: ${error.message}`);
  if (!item?.product_id) return { ok: false, reason: "notFound" };
  const { data: order, error: orderError } = await ctx.db
    .from("orders")
    .select("id, status, telegram_id, created_at")
    .eq("id", item.order_id)
    .maybeSingle();
  if (orderError) throw serverFailure(`Заказ не прочитан: ${orderError.message}`);
  if (order?.status !== "delivered") return { ok: false, reason: "notFound" };
  const course = parseCourse(await readSetting(ctx, courseKey(item.product_id)));
  const base: CoursePurchase = {
    orderItemId: item.id,
    orderId: item.order_id,
    boughtAt: order.created_at,
    variantId: item.product_variant_id ?? null,
    telegramId: order.telegram_id ?? null,
    productId: item.product_id,
    name: item.name_snapshot,
    course,
    run: parseRun(await readSetting(ctx, runKey(item.id))),
  };
  const run = await startRun(ctx, base, now);
  if (purchaseTimeline(ctx, { ...base, run }, now).tariff.accessDays == null)
    return { ok: false, reason: "unlimited" };

  let verdict = "ok" as "notLater" | "wasEnded" | "ok";
  const written = await updateSettingAtomic(ctx, runKey(item.id), (raw) => {
    const cur = parseRun(raw) ?? run;
    const expires = purchaseTimeline(ctx, { ...base, run: cur }, now).expiresAt;
    // Новый срок обязан быть позже действующего (и позже «сейчас»), иначе это не продление.
    if (until.getTime() <= now.getTime() || (expires && until.getTime() <= Date.parse(expires))) {
      verdict = "notLater";
      return null;
    }
    if (cur.accessEnded) verdict = "wasEnded";
    const { accessEnded: _ended, ...rest } = cur;
    return JSON.stringify({ ...rest, until: until.toISOString() });
  });
  if (verdict === "notLater") return { ok: false, reason: "notLater" };
  if (written !== "written") return { ok: false, reason: "changed" };

  if (verdict === "wasEnded") {
    // Доступ уже закрывали по сроку: снимаем метки «снято», новая ссылка — по запросу ученика.
    for (const slot of [CHANNEL_SLOT, CHAT_SLOT])
      await updateSettingAtomic(ctx, slot.key(item.id), (raw) => (raw ? "{}" : null));
  }
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(ctx, item.order_id, "access_extended", { until: day, reason: why }, actor);
  return { ok: true, until: until.toISOString() };
}
