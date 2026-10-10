import { env } from "@/config/env";
import { orderChannel } from "@/core/orders/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { telegramLanguageAsker, telegramMaterialSender } from "@/channels/telegram/deliver";
import { COPY } from "@/channels/telegram/copy";
import {
  deliverOrder,
  displayNo,
  getOrder,
  rejectOrder,
  type DeliverOptions,
} from "@/core/orders/orders";
import { UserError } from "@/core/i18n/user-error";
import { isAdminKey, type AdminT } from "@/app/i18n/admin";
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import { adminTFor } from "./locale.server";
import { api, notifyCustomer, notifyReferralGrant } from "./customer-notify.server";

/** Действия над заказом из админки: курьер, фото, возврат, смена статуса. */

export type OrderAction = "confirm" | "reject" | "next" | "prev" | "remind";

/** Название статуса заказа на языке админки; неизвестный статус — как есть. */
function statusName(t: AdminT, status: string): string {
  const key = `orders.status.${status}`;
  return isAdminKey(key) ? t(key) : status;
}

function platformName(platform: string): string {
  return (
    (
      { instagram: "Instagram", whatsapp: "WhatsApp", telegram: "Telegram" } as Record<
        string,
        string
      >
    )[platform] ?? platform
  );
}

/**
 * Передать физический заказ курьеру (модуль courier, core/fulfillment/courier):
 * событие таймлайна со службой, ссылкой и телефоном, покупателю — сообщение
 * со ссылкой в его канале. Заказ сохраняется, даже если сообщение не дошло.
 */
export async function dispatchCourier(
  ctx: TenantContext,
  id: number,
  input: { provider: string; trackUrl?: string | null; phone?: string | null },
  actor = "admin",
): Promise<{ ok: true; message: string; notified: boolean }> {
  const t = await adminTFor(ctx);
  const order = await getOrder(ctx, id);
  if (!order) throw new UserError("err.admin.orderNotFound", "Заказ не найден");
  const c = await import("@/core/fulfillment/courier");
  if (
    order.fulfillment_kind !== "physical" ||
    !(c.COURIER_STATUSES as readonly string[]).includes(order.status)
  )
    throw new UserError("err.courier.status", "Передать курьеру можно физический заказ в работе");
  const provider = c.COURIER_PROVIDERS.find((p) => p === input.provider) ?? "other";
  const trackUrl = input.trackUrl?.trim() ? c.safeTrackUrl(input.trackUrl) : null;
  if (input.trackUrl?.trim() && !trackUrl)
    throw new UserError(
      "err.courier.badUrl",
      "Ссылка на отслеживание должна начинаться с https://",
    );
  const phone = input.phone?.trim() ? c.cleanPhone(input.phone) : null;
  if (input.phone?.trim() && !phone)
    throw new UserError("err.courier.badPhone", "Телефон курьера — цифры, от 5 знаков");
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(ctx, order.id, "courier", { provider, trackUrl, phone }, actor);
  const no = displayNo(order);
  const notified = await notifyCustomer(
    ctx,
    order,
    c.courierMessage(no, { provider, trackUrl, phone }),
  ).catch(() => false);
  return {
    ok: true,
    notified,
    message: t(notified ? "msg.courier.sent" : "msg.courier.saved", { no: String(no) }),
  };
}

/**
 * Фото готового заказа покупателю на согласование (core/orders/approval).
 * Telegram — фото с кнопками «Всё нравится» / «Нужны правки»; Instagram и
 * WhatsApp — фото с просьбой ответить «да» или написать правки (ответ ловит
 * магазин в переписке по mode = awaiting_approval); сайт без Telegram —
 * письмом со ссылкой на фото, ответ покупатель пишет продавцу сам.
 */
export async function sendApprovalPhoto(
  ctx: TenantContext,
  id: number,
  input: { key: string; note?: string | null },
  actor = "admin",
): Promise<{ ok: true; message: string }> {
  const t = await adminTFor(ctx);
  const order = await getOrder(ctx, id);
  if (!order) throw new UserError("err.admin.orderNotFound", "Заказ не найден");
  const { APPROVAL_STATUSES } = await import("@/core/orders/approval");
  if (
    order.fulfillment_kind !== "physical" ||
    !(APPROVAL_STATUSES as readonly string[]).includes(order.status)
  )
    throw new UserError(
      "err.approval.status",
      "Фото на согласование — для физического заказа в работе",
    );
  const att = await import("./chat-attachment.server");
  const checked = await att.checkChatAttachment(ctx, {
    kind: "photo",
    key: input.key,
    name: "photo",
  });
  const no = displayNo(order);
  const note = input.note?.trim().slice(0, 500);
  const intro = `📸 Ваш заказ #${no} готов — посмотрите, всё ли так.${note ? `\n${note}` : ""}`;
  const channel = orderChannel(order.platform);
  const tgId = Number(order.telegram_id);
  const { getCustomerByTelegramId, setState } = await import("@/core/customers/customers");
  if (channel === "manual")
    throw new UserError("err.approval.noChat", "У ручного заказа нет переписки с покупателем");
  if (channel === "telegram" || (channel === "web" && tgId > 0 && ctx.tenant.telegramTokenEnc)) {
    const { telegramUpload } = await import("@/channels/telegram/api");
    const r = await telegramUpload(
      ctx.secrets.telegramToken(),
      env().TELEGRAM_API_BASE,
      "sendPhoto",
      {
        chat_id: tgId,
        caption: intro,
        reply_markup: JSON.stringify({
          inline_keyboard: [
            [
              { text: "✅ Всё нравится", callback_data: `appr:ok:${order.id}` },
              { text: "✏️ Нужны правки", callback_data: `appr:fix:${order.id}` },
            ],
          ],
        }),
      },
      { field: "photo", name: checked.fileName, data: checked.data },
    );
    if (!r.ok) throw att.telegramRefusal(r.description);
  } else if (channel === "zernio") {
    const { zernioTargetForOrder } = await import("@/channels/zernio/outbound.server");
    const target = await zernioTargetForOrder(ctx, order);
    if (!target)
      throw new UserError(
        "err.admin.noZernioDialog",
        "У покупателя нет диалога в Zernio — ответить некуда",
      );
    const { sendInboxMessage } = await import("@/channels/zernio/api.server");
    const media = await att.zernioAttachmentOptions(ctx, target.platform, intro, checked);
    const r = await sendInboxMessage(
      target.conversationId,
      target.accountId,
      `${media.text}\n\nЕсли всё нравится — ответьте «да». Если нужно что-то поправить — напишите что.`,
      {
        platform: target.platform,
        ...media,
        idempotencyScope: `approval:${order.id}:${input.key}`,
      },
    );
    if (!r.ok)
      throw new UserError("err.admin.channelRefused", "Сообщение не ушло: {reason}", {
        reason: r.error ?? "",
      });
    const customer = await getCustomerByTelegramId(ctx, tgId);
    if (customer)
      await setState(ctx, customer, {
        ...customer.state,
        mode: "awaiting_approval",
        approval_order_id: order.id,
      });
  } else {
    const { imageUrl } = await import("@/core/catalog/catalog");
    const sent = await notifyCustomer(
      ctx,
      order,
      `${intro}\n${imageUrl(ctx, input.key)}\nЕсли что-то поправить — напишите продавцу.`,
    );
    if (!sent) throw new UserError("err.admin.sendFailed", "Не удалось отправить сообщение");
  }
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(ctx, order.id, "approval_sent", { key: input.key, channel }, actor);
  return { ok: true, message: t("msg.approval.sent", { no }) };
}

/**
 * Возврат из карточки заказа: запись возврата (core/orders/refund) и, если
 * продавец не снял галочку, сообщение покупателю в его канал — сумма и
 * причина. Недоставленное сообщение возврат не отменяет.
 */
export async function refundAndNotify(
  ctx: TenantContext,
  id: number,
  input: { amount: number; reason?: string | null; restock?: boolean; notify?: boolean },
  actor = "admin",
): Promise<{ ok: true; message: string; notified: boolean }> {
  const t = await adminTFor(ctx);
  const { refundOrder } = await import("@/core/orders/refund");
  const r = await refundOrder(ctx, id, input, actor);
  // Полный возврат курса — доступ в закрытый канал снимается (исключение и
  // отзыв личной ссылки), итог — событием в истории заказа; страница курса
  // закрывается сама: заказ не «выдан».
  if (r.full && ctx.tenant.modules.courses && ctx.tenant.telegramTokenEnc) {
    const { revokeChannelsOnRefund } = await import("@/core/courses/channel.server");
    const { telegramChannelInviter } = await import("@/channels/telegram/courses");
    await revokeChannelsOnRefund(ctx, id, telegramChannelInviter(api(ctx)), actor);
  }
  const order = await getOrder(ctx, id);
  const no = order ? displayNo(order) : id;
  const sum = `${r.amount} ${r.currency}`;
  let notified = false;
  if (order && input.notify !== false) {
    const reason = input.reason?.trim();
    const buyerM = COPY[await orderBuyerLocale(ctx, order)];
    const text = `${buyerM.orderRefunded(no, r.full, sum)}${reason ? `\n${reason}` : ""}`;
    notified = await notifyCustomer(ctx, order, text).catch(() => false);
  }
  return {
    ok: true,
    notified,
    message: t(r.full ? "msg.refund.full" : "msg.refund.partial", { no, sum }),
  };
}

export async function runOrderAction(
  ctx: TenantContext,
  id: number,
  action: OrderAction,
  actor = "admin",
): Promise<{ ok: boolean; message: string }> {
  const t = await adminTFor(ctx);
  const order = await getOrder(ctx, id);
  if (!order) return { ok: false, message: t("err.admin.orderNotFound") };
  const no = displayNo(order);
  const status = statusName(t, order.status);
  // Покупателю — на его языке, не на языке продавца.
  const buyerLocale = await orderBuyerLocale(ctx, order);
  const m = COPY[buyerLocale];
  // Решение из админки — как кнопка в Telegram: снять кнопки уведомления,
  // через 5 минут убрать его из чатов продавцов.
  const decided = async () => {
    if (!ctx.tenant.telegramTokenEnc) return;
    const { scheduleOrderNotifyDismiss } = await import("@/channels/telegram/order-notify");
    await scheduleOrderNotifyDismiss(ctx, api(ctx), id);
  };
  switch (action) {
    case "reject": {
      const ok = await rejectOrder(ctx, id, actor);
      if (ok) await decided();
      if (ok) await notifyCustomer(ctx, order, m.orderRejected(no));
      return ok
        ? { ok, message: t("msg.orders.rejected", { no }) }
        : { ok, message: t("msg.orders.alreadyClosed", { no, status }) };
    }
    case "confirm": {
      if (order.fulfillment_kind === "physical") {
        const { acceptPhysicalOrder } = await import("@/core/orders/physical-admin");
        const r = await acceptPhysicalOrder(ctx, id, actor);
        if (r.ok) await decided();
        if (r.ok) await notifyCustomer(ctx, order, m.orderAccepted(no));
        return {
          ok: r.ok,
          message: r.ok
            ? r.recorded > 0
              ? t("msg.orders.acceptedPaid", { no, sum: `${r.recorded} ${order.currency}` })
              : t("msg.orders.accepted", { no })
            : t("msg.orders.cannotAccept", { no, status }),
        };
      }
      let sender = telegramMaterialSender(api(ctx), order.telegram_id, m);
      let channelNotes: string[] = [];
      // Счёт ссылкой: копия файлов в диалог не подтвердилась — ссылка на страницу заказа в «выдан».
      let copyFailedPage: () => string | null = () => null;
      let opts: DeliverOptions = {
        lang: buyerLocale,
        ask: telegramLanguageAsker(api(ctx), order.telegram_id, m),
        actor,
      };
      if (orderChannel(order.platform) === "web") {
        // Заказ с сайта: материалы — на странице заказа и копией на почту.
        const { webMaterialSender } = await import("@/core/storefront/web-order");
        sender = webMaterialSender;
        opts = { lang: buyerLocale, allWhenAmbiguous: true, actor };
      } else if (orderChannel(order.platform) !== "telegram") {
        const { isInvoiceLink } = await import("@/core/orders/invoice-link");
        if (await isInvoiceLink(ctx, order.id)) {
          // Счёт ссылкой: выдача на страницу заказа, в диалог — копия.
          const { invoiceLinkSender } = await import("@/channels/web/order.server");
          const inv = await invoiceLinkSender(ctx, order);
          sender = inv.send;
          copyFailedPage = inv.copyFailedPage;
        } else {
          const { zernioDeliverySender, zernioTargetForOrder } =
            await import("@/channels/zernio/outbound.server");
          const target = await zernioTargetForOrder(ctx, order);
          if (!target)
            return {
              ok: false,
              message: t("msg.orders.noDialog", { platform: platformName(order.platform) }),
            };
          const d = await zernioDeliverySender(ctx, target, order);
          sender = d.send;
          // Окно 24 часа закрыто: причина и что ушло покупателю — продавцу в ответ.
          channelNotes = d.notes;
        }
        opts = { lang: buyerLocale, allWhenAmbiguous: true, actor };
      }
      const r = await deliverOrder(ctx, id, sender, opts);
      if (r.failed === 0) await decided();
      if (r.alreadyDelivered)
        return { ok: true, message: t("msg.orders.alreadyDelivered", { no }) };
      if (r.failed === 0 && r.pending > 0)
        return {
          ok: true,
          message: t("msg.orders.langAsked", { no, count: r.pending }),
        };
      if (r.failed === 0) {
        const { deliveredMessage } = await import("@/core/delivery/note.server");
        // Покупателю с сайта материалы уже ушли письмом — второе письмо не шлём.
        const page = copyFailedPage();
        const delivered = await deliveredMessage(ctx, order.platform, m.orderDelivered(no));
        await notifyCustomer(
          ctx,
          order,
          page ? `${delivered}\n\n${m.deliveryOrderPage} ${page}` : delivered,
          { email: false },
        );
        if (r.pointsEarned > 0)
          await notifyCustomer(ctx, order, m.pointsEarned(r.pointsEarned), { email: false });
        await notifyReferralGrant(ctx, r.referral);
        return {
          ok: true,
          message: [t("msg.orders.delivered", { no, count: r.sent }), ...channelNotes].join(" "),
        };
      }
      return {
        ok: false,
        message: t("msg.orders.partial", { sent: r.sent, failed: r.failed }),
      };
    }
    case "next":
    case "prev": {
      const { PHYSICAL_NEXT, PHYSICAL_PREV, setPhysicalStatus } =
        await import("@/core/orders/admin");
      const to = (action === "next" ? PHYSICAL_NEXT : PHYSICAL_PREV)[order.status];
      // Шаги сборки — только у физического заказа: так же решает `orderActions` для кнопок.
      if (!to || order.fulfillment_kind !== "physical")
        return { ok: false, message: t("msg.orders.noTransition") };
      // «Готов» → закрытие: у доставки «Отправлен», у самовывоза и старых заказов «Выдан» (Х4).
      const { defaultHandoverStep } = await import("@/core/orders/handover");
      const step = to === "delivered" ? defaultHandoverStep(order.fulfillment_type) : undefined;
      const ok = await setPhysicalStatus(ctx, id, order.status, to);
      if (ok) {
        const { recordOrderEvent } = await import("@/core/orders/events");
        await recordOrderEvent(ctx, id, "status", step ? { to, step } : { to }, actor);
      }
      if (ok && action === "next")
        await notifyCustomer(
          ctx,
          order,
          step === "shipped" ? m.orderShipped(no) : m.orderStatusNotice(to, no),
        );
      if (ok && to === "delivered") {
        const { rewardReferrerIfFirstDelivery } = await import("@/core/referrals/referrals");
        // Статус уже сменён: сбой награды не должен выглядеть как сбой смены.
        const grant = await rewardReferrerIfFirstDelivery(ctx, order.telegram_id).catch((e) => {
          console.error(`[admin] награда пригласившему, заказ #${no}: ${String(e)}`);
          return null;
        });
        await notifyReferralGrant(ctx, grant);
      }
      return {
        ok,
        message: ok
          ? t("msg.orders.status", {
              status: step === "shipped" ? t("order.step.shipped") : statusName(t, to),
            })
          : t("msg.orders.statusChanged"),
      };
    }
    case "remind": {
      if (order.status !== "awaiting_payment")
        return { ok: false, message: t("msg.orders.remindOnlyAwaiting") };
      const { claimOrderEvent } = await import("@/core/orders/events");
      const web = order.platform === "web";
      if (web) {
        // Заказ с сайта: тот же ключ, что у письма-напоминания крона (core/storefront/web-remind) —
        // одно напоминание на заказ, двойной клик и крон второго письма не шлют.
        const claimed = await claimOrderEvent(
          ctx,
          id,
          "reminded",
          "email",
          { channel: "email", to: order.customer_email ?? "" },
          actor,
        );
        if (!claimed) return { ok: false, message: t("msg.orders.alreadyReminded") };
        const { amountDueNow } = await import("@/core/fulfillment/fulfillment");
        const { formatMoney } = await import("@/core/money/money");
        const due = await amountDueNow(ctx, {
          total: Number(order.total),
          fulfillment_kind: order.fulfillment_kind,
        });
        const ok = await notifyCustomer(
          ctx,
          order,
          `⏰ Напоминаем: заказ #${no} на ${formatMoney(due, order.currency)} ждёт оплаты. Оплатить можно на странице заказа.`,
        );
        return { ok, message: ok ? t("msg.orders.reminded") : t("msg.orders.remindFailed") };
      }
      // Заказ из чата: тот же ключ и тот же текст, что у напоминания крона
      // (core/orders/pay-remind) — сумма, реквизиты или ссылка счёта.
      const { claimPayReminder, payReminderFor } = await import("@/core/orders/pay-remind");
      if (!(await claimPayReminder(ctx, id, order.platform ?? "telegram", actor)))
        return { ok: false, message: t("msg.orders.alreadyReminded") };
      const { reminderText } = await import("@/app/orders/pay-remind.server");
      const ok = await notifyCustomer(
        ctx,
        order,
        await reminderText(ctx, await payReminderFor(ctx, order)),
      );
      return {
        ok,
        message: ok ? t("msg.orders.reminded") : t("msg.orders.remindFailed"),
      };
    }
  }
}
