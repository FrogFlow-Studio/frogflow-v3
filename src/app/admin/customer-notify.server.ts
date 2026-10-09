import { env } from "@/config/env";
import { orderChannel } from "@/core/orders/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { telegramApi } from "@/channels/telegram/api";
import { COPY } from "@/channels/telegram/copy";
import { displayNo, getOrder, type OrderWithItems } from "@/core/orders/orders";
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import { adminTFor } from "./locale.server";

/** Уведомления покупателю: статус заказа, трекинг, рефералы, сборка. */

export function api(ctx: TenantContext) {
  return telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
}

/**
 * Уведомить покупателя в его канале: Telegram или Instagram/WhatsApp через
 * Zernio. Заказ с сайта: покупатель вошёл через Telegram (у заказа его
 * настоящий telegram_id) — сообщением в Telegram, иначе письмом со ссылкой
 * на страницу заказа. `email: false` — письмом не дублировать (материалы
 * уже ушли письмом при выдаче).
 */
export async function notifyCustomer(
  ctx: TenantContext,
  order: OrderWithItems,
  text: string,
  opts: { email?: boolean } = {},
): Promise<boolean> {
  const { sendOrEnqueue } = await import("@/core/outbox/outbox");
  const channel = orderChannel(order.platform);
  // Ручной заказ продавец завёл сам — чата с покупателем нет (как в v1).
  if (channel === "manual") return false;
  if (channel === "web" && !(Number(order.telegram_id) > 0 && ctx.tenant.telegramTokenEnc)) {
    if (opts.email === false) return false;
    const { emailOrderNotice } = await import("@/core/storefront/web-notify");
    return emailOrderNotice(ctx, order, text, env().SESSION_SECRET);
  }
  if (channel === "zernio") {
    const { zernioTargetForOrder } = await import("@/channels/zernio/outbound.server");
    const { zernioOutboxSender } = await import("@/channels/zernio/outbox.server");
    const target = await zernioTargetForOrder(ctx, order);
    if (!target) return false;
    return sendOrEnqueue(
      ctx,
      {
        kind: "customer_notice",
        target: { channel: "zernio", ...target },
        text,
        orderId: order.id,
        audience: "customer",
      },
      zernioOutboxSender(),
    );
  }
  // Синтетический telegram_id: в Telegram писать некуда, sendMessage даст 400.
  if (!ctx.tenant.telegramTokenEnc || Number(order.telegram_id) <= 0) return false;
  const { telegramOutboxSender } = await import("@/channels/telegram/outbox");
  const ok = await sendOrEnqueue(
    ctx,
    {
      kind: "customer_notice",
      target: { channel: "telegram", chatId: String(order.telegram_id) },
      text,
      orderId: order.id,
      audience: "customer",
    },
    telegramOutboxSender,
  );
  if (!ok) {
    const { recordOrderEvent } = await import("@/core/orders/events");
    await recordOrderEvent(ctx, order.id, "notify_failed", {
      text: text.slice(0, 120),
      retrying: true,
    });
  }
  return ok;
}

/**
 * Трек-номер из админки (Х5): заказ с доставкой отмечается отправленным (из
 * «собран»), покупателю уходит номер и ссылка — один раз на номер. «Один раз»:
 * событие `tracking` пишется до отправки, шлёт только выигравшая запись; сбой
 * отправки не повторяем (сообщение могло дойти). Исправленный номер — новое
 * сообщение. Заказ другого магазина читается как «не найден».
 */
export async function runOrderTracking(
  ctx: TenantContext,
  id: number,
  text: string,
  actor = "admin",
): Promise<{ ok: boolean; message: string }> {
  const t = await adminTFor(ctx);
  const order = await getOrder(ctx, id);
  if (!order) return { ok: false, message: t("err.admin.orderNotFound") };
  const { trackingFromText, trackingKey, trackingMessage, trackingPayload } =
    await import("@/core/orders/tracking");
  const track = trackingFromText(text);
  if (!track) return { ok: false, message: t("msg.orders.trackBad") };
  if (
    order.fulfillment_kind !== "physical" ||
    order.fulfillment_type === "pickup" ||
    (order.status !== "ready" && order.status !== "delivered")
  )
    return { ok: false, message: t("msg.orders.trackNeedReady") };
  const no = displayNo(order);
  const { recordOrderEvent, claimOrderEvent } = await import("@/core/orders/events");
  if (order.status === "ready") {
    const { setPhysicalStatus } = await import("@/core/orders/admin");
    if (await setPhysicalStatus(ctx, id, "ready", "delivered")) {
      await recordOrderEvent(ctx, id, "status", { to: "delivered", step: "shipped" }, actor);
      const { rewardReferrerIfFirstDelivery } = await import("@/core/referrals/referrals");
      // Статус уже сменён: сбой награды не должен выглядеть как сбой отправки.
      const grant = await rewardReferrerIfFirstDelivery(ctx, order.telegram_id).catch((e) => {
        console.error(`[admin] награда пригласившему, заказ #${no}: ${String(e)}`);
        return null;
      });
      await notifyReferralGrant(ctx, grant);
    }
  }
  const label = track.number ?? track.url ?? "";
  const claimed = await claimOrderEvent(
    ctx,
    id,
    "tracking",
    trackingKey(track),
    trackingPayload(track),
    actor,
  );
  if (!claimed) return { ok: false, message: t("msg.orders.trackAlready") };
  const sent = await notifyCustomer(
    ctx,
    order,
    trackingMessage(await orderBuyerLocale(ctx, order), no, track),
  );
  return sent
    ? { ok: true, message: t("msg.orders.trackSent", { label }) }
    : { ok: false, message: t("msg.orders.trackNotSent") };
}

export async function notifyReferralGrant(
  ctx: TenantContext,
  grant: { telegramId: number; code: string; percent: number } | null | undefined,
): Promise<void> {
  const { notifyReferralReward } = await import("@/channels/telegram/referral-notify");
  await notifyReferralReward(ctx, grant, ctx.tenant.telegramTokenEnc ? api(ctx) : null);
}

/**
 * «Отметить собранными» пачкой (А16, core/orders/batch): покупателю уходит то же
 * «Заказ готов к выдаче», что при одиночном «дальше», — только тем заказам, чей
 * статус сменила именно эта запись, на языке покупателя.
 */
export async function assembleOrdersAndNotify(
  ctx: TenantContext,
  sel: import("@/core/orders/batch").BatchSelection,
  actor = "admin",
) {
  const { assembleOrders } = await import("@/core/orders/batch");
  return assembleOrders(ctx, sel, actor, async (order) => {
    const m = COPY[await orderBuyerLocale(ctx, order)];
    return notifyCustomer(ctx, order, m.orderStatusNotice("ready", displayNo(order)));
  });
}
