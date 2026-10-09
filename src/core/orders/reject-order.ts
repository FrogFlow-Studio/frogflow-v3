import { UserError } from "@/core/i18n/user-error";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordOrderEvent } from "./events";
import { restoreOrderStock } from "@/core/fulfillment/fulfillment";
import { restorePoints, returnOrderCodes } from "@/core/discounts/discounts";
import { serverFailure } from "@/lib/server-failure";
import { DELIVERABLE_STATUSES, type OrderWithItems, REJECTABLE_STATUSES } from "./order-model";

/** Захват заказа под выдачу и отклонение. */

/** CAS-захват на выдачу: из awaiting_* в delivering, иначе — уже выдан или нельзя. */
export async function claimOrderForDelivery(
  ctx: TenantContext,
  orderId: number,
  actor = "bot",
): Promise<OrderWithItems | null> {
  const { data, error } = await ctx.db
    .from("orders")
    .update({ status: "delivering", delivery_index: 0, delivery_retry_count: 0 })
    .eq("id", orderId)
    .in("status", [...DELIVERABLE_STATUSES])
    .select("*, order_items(*)")
    .maybeSingle();
  if (error) throw serverFailure(error.message);
  if (data) {
    await recordOrderEvent(ctx, orderId, "delivery_started", {}, actor);
    return data as OrderWithItems;
  }
  const { data: existing, error: existingError } = await ctx.db
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (existingError) throw serverFailure(`Заказ #${orderId} не прочитан: ${existingError.message}`);
  if (!existing) throw new UserError("err.orders.notFound", "Заказ не найден");
  if (existing.status === "delivered" || existing.status === "delivering") return null;
  throw new UserError("err.orders.cannotDeliver", "Заказ #{no} нельзя выдать (статус: {status})", {
    no: orderId,
    status: existing.status,
  });
}

export async function rejectOrder(
  ctx: TenantContext,
  orderId: number,
  actor = "bot",
  opts: {
    /** Из каких статусов можно отклонить; по умолчанию — все открытые. */
    from?: readonly string[];
    /** «cancelled» — заказ закрыт без решения продавца (истёк срок оплаты). */
    to?: "rejected" | "cancelled";
    /** Вернуть остаток на склад в любом случае (счёт ссылкой, чей признак не записался). */
    restoreStock?: boolean;
  } = {},
): Promise<boolean> {
  // Переход статуса — CAS. Сначала из «ждёт оплаты»: так известно, что
  // заказ отменён неоплаченным, и его промокод и сертификат возвращаются.
  const from: string[] = [...(opts.from ?? REJECTABLE_STATUSES)];
  // Неоплаченный — ещё и без внесённых денег: «Внести оплату» пишет
  // paid_amount, не меняя статуса, и такой заказ кодов не возвращает.
  // Условие — в самой условной записи, чтобы оплата в ту же секунду не
  // проскочила между проверкой и отменой. «Чек на проверке» неоплаченным не
  // считаем: покупатель, возможно, уже заплатил.
  const cas = async (statuses: string[], unpaid: boolean) => {
    if (statuses.length === 0) return null;
    let q = ctx.db
      .from("orders")
      .update({ status: opts.to ?? "rejected" })
      .eq("id", orderId)
      .in("status", statuses);
    if (unpaid) q = q.not("paid_amount", "gt", 0);
    return (
      await q
        .select("id, platform, telegram_id, points_used, points_earned, promo_code")
        .maybeSingle()
    ).data;
  };
  const unpaidData = from.includes("awaiting_payment")
    ? await cas(["awaiting_payment"], true)
    : null;
  const data = unpaidData ?? (await cas(from, false));
  // Брошенный неоплаченный заказ не сжигает сертификат покупателя и не
  // расходует лимит промокода; возвращает только выигравший CAS выше.
  const codesReturned = unpaidData
    ? await returnOrderCodes(ctx, orderId, unpaidData.promo_code).catch((e) => {
        console.error(`[orders] возврат кодов заказа #${orderId}: ${String(e)}`);
        return null;
      })
    : null;
  // Списанные в заказе баллы — обратно покупателю. Переход статуса выше —
  // CAS, поэтому возвращает ровно один вызов, сколько бы их ни пришло
  // (кнопка продавца, срок жизни неоплаченного заказа с сайта).
  // Заказ уже был выдан и начислил баллы (продавец отклонил после неудачной
  // повторной выдачи) — списанное не возвращаем: покупатель получил бы и
  // скидку, и начисление за ту же покупку.
  const earned = Number(data?.points_earned) || 0;
  const pointsReturned =
    data && earned <= 0 ? Math.max(0, Math.floor(Number(data.points_used) || 0)) : 0;
  if (pointsReturned > 0) await restorePoints(ctx, Number(data!.telegram_id), pointsReturned);
  if (data)
    await recordOrderEvent(
      ctx,
      orderId,
      "rejected",
      {
        ...(opts.to === "cancelled" ? { to: "cancelled" } : {}),
        ...(pointsReturned > 0 ? { pointsReturned } : {}),
        ...(codesReturned?.promo ? { promoReturned: true } : {}),
        ...(codesReturned?.gift ? { giftReturned: true } : {}),
      },
      actor,
    );
  // Заказ с сайта оформляет кто угодно — отклонённый возвращает остаток.
  // Так же счёт ссылкой из диалога: его повтор после сбоя не держит товар.
  // И любой неоплаченный заказ (в том числе из бота и Direct): остаток списан
  // при оформлении, а сам такой заказ не истекает. Оплаченный решает возврат.
  // Статус уже сменён: сбой возврата на склад не должен терять событие и баллы ниже.
  const restock = () =>
    restoreOrderStock(ctx, orderId, "cancel", actor).catch((e) =>
      console.error(`[orders] возврат на склад заказа #${orderId}: ${String(e)}`),
    );
  if (data?.platform === "web" || unpaidData || (data && opts.restoreStock)) await restock();
  else if (data) {
    const { isInvoiceLink } = await import("./invoice-link");
    if (await isInvoiceLink(ctx, orderId)) await restock();
  }
  return Boolean(data);
}
