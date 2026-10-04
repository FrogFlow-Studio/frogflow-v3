import { env } from "@/config/env";
import { orderChannel } from "@/core/orders/pure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { telegramApi } from "@/channels/telegram/api";
import type { ChatAttachment } from "./chat-attachment.server";
import { telegramLanguageAsker, telegramMaterialSender } from "@/channels/telegram/deliver";
import { COPY } from "@/channels/telegram/copy";
import {
  deliverOrder,
  displayNo,
  getOrder,
  rejectOrder,
  type OrderWithItems,
  type DeliverOptions,
} from "@/core/orders/orders";
import { hashPassword, verifyPassword } from "@/app/auth/password";
import { UserError } from "@/core/i18n/user-error";
import { isAdminKey, type AdminT } from "@/app/i18n/admin";
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import { adminTFor } from "./locale.server";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import {
  adminLoginTaken,
  findAdminLogin,
  normalizeLogin,
  STAFF_LOGIN_RE,
  type AdminLogin,
  type StaffRole,
} from "@/core/auth/roles";

/** Кто входит под логином: владелец или пользователь магазина (core/auth/roles). */
export async function resolveAdminLogin(username: string): Promise<AdminLogin | null> {
  return findAdminLogin(await tenantDirectory(true), username);
}

export function checkAdminPassword(login: AdminLogin, password: string): boolean {
  return verifyPassword(password, login.passwordHash);
}

/* ── команда магазина: пользователи с ролями в bots.settings.admin.users ── */

export type TeamMember = {
  username: string;
  name: string | null;
  role: StaffRole;
  createdAt: string | null;
};

export function listTeam(ctx: TenantContext): TeamMember[] {
  return (ctx.tenant.settings.admin?.users ?? []).map((u) => ({
    username: u.username,
    name: u.name ?? null,
    role: u.role,
    createdAt: u.created_at ?? null,
  }));
}

export async function saveTeamMember(
  ctx: TenantContext,
  input: { username: string; name?: string; role: StaffRole; password?: string },
): Promise<void> {
  const username = normalizeLogin(input.username);
  if (!STAFF_LOGIN_RE.test(username))
    throw new UserError(
      "err.admin.loginFormat",
      "Логин: латиница, цифры, точка, дефис и «_», от 3 до 40 символов.",
    );
  if (username === ctx.tenant.settings.admin?.username)
    throw new UserError("err.admin.loginIsOwner", "Это логин владельца магазина.");
  const users = [...(ctx.tenant.settings.admin?.users ?? [])];
  const existing = users.find((u) => u.username === username);
  if (adminLoginTaken(await tenantDirectory(true), username, { botId: ctx.tenant.id, username }))
    throw new UserError("err.admin.loginTaken", "Логин «{login}» уже занят.", { login: username });
  if (!existing && !input.password)
    throw new UserError("err.admin.passwordRequired", "Для нового пользователя нужен пароль.");
  if (input.password && input.password.length < 8)
    throw new UserError("err.admin.passwordShort", "Пароль — не короче 8 символов.");
  const next = {
    username,
    password_hash: input.password ? hashPassword(input.password) : existing!.password_hash,
    role: input.role,
    name: input.name?.trim() || undefined,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  const merged = existing
    ? users.map((u) => (u.username === username ? next : u))
    : [...users, next];
  if (merged.length > 20)
    throw new UserError("err.admin.teamLimit", "Не больше 20 пользователей у магазина.");
  await patchTenantSettings(ctx.tenant.id, { admin: { users: merged } });
}

export async function deleteTeamMember(ctx: TenantContext, username: string): Promise<void> {
  const u = normalizeLogin(username);
  const users = (ctx.tenant.settings.admin?.users ?? []).filter((x) => x.username !== u);
  await patchTenantSettings(ctx.tenant.id, { admin: { users } });
}

function api(ctx: TenantContext) {
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
          sender = await invoiceLinkSender(ctx, order);
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
        await notifyCustomer(
          ctx,
          order,
          await deliveredMessage(ctx, order.platform, m.orderDelivered(no)),
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
      if (!to) return { ok: false, message: t("msg.orders.noTransition") };
      const ok = await setPhysicalStatus(ctx, id, order.status, to);
      if (ok) {
        const { recordOrderEvent } = await import("@/core/orders/events");
        await recordOrderEvent(ctx, id, "status", { to }, actor);
      }
      if (ok && action === "next") await notifyCustomer(ctx, order, m.orderStatusNotice(to, no));
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
          ? t("msg.orders.status", { status: statusName(t, to) })
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

/** Ответ менеджера из панели: тем же sendMessage, что и у бота, плюс запись в лог чата. */
/** Ответ менеджера из панели — в канал покупателя: Telegram или Instagram/WhatsApp через Zernio. */
export async function replyAsManager(
  ctx: TenantContext,
  telegramId: number,
  text: string,
  attachment?: ChatAttachment,
  /** Id черновика со страницы «Чат»: повтор отправки после ошибки не удвоит сообщение. */
  draftId?: string,
  /** Кнопки под сообщением — только в Telegram (Direct/WhatsApp их здесь не рисуют). */
  options: { replyMarkup?: { inline_keyboard: { text: string; callback_data: string }[][] } } = {},
): Promise<void> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  const att = await import("./chat-attachment.server");
  const checked = attachment ? await att.checkChatAttachment(ctx, attachment) : null;
  // Как orderChannel: в Zernio только Instagram и WhatsApp, незнакомое — Telegram.
  if (customer && (customer.platform === "instagram" || customer.platform === "whatsapp")) {
    if (!customer.zernioConversationId || !customer.zernioAccountId)
      throw new UserError(
        "err.admin.noZernioDialog",
        "У покупателя нет диалога в Zernio — ответить некуда",
      );
    const { sendInboxMessage } = await import("@/channels/zernio/api.server");
    const { isAttachmentRejected } = await import("@/channels/zernio/errors");
    const { text: message, ...media } = checked
      ? await att.zernioAttachmentOptions(ctx, customer.platform, text, checked)
      : { text };
    const conversationId = customer.zernioConversationId;
    const accountId = customer.zernioAccountId;
    const platform = customer.platform;
    const send = (body: string, extra: typeof media) =>
      sendInboxMessage(conversationId, accountId, body, {
        platform,
        ...extra,
        ...(draftId ? { idempotencyScope: `chat:${draftId}` } : {}),
      });
    let r = await send(message, media);
    // Канал отклонил сам файл (Instagram — PDF больше лимита, битый и т. п.):
    // та же ссылка на 7 дней уходит текстом, как у форматов, которые канал не берёт.
    if (
      !r.ok &&
      isAttachmentRejected(r.failure) &&
      media.attachmentType === "file" &&
      media.attachmentUrl
    )
      r = await send(
        att.withFileLink(text, media.attachmentName ?? "file", media.attachmentUrl),
        {},
      );
    // Окно 24 часа закрыто (errors.ts): WhatsApp — одобренным шаблоном,
    // Instagram — писать первым нельзя, продавцу — ссылка на страницу заказа.
    let viaTemplate = false;
    const { classifyZernioFailure } = await import("@/channels/zernio/errors");
    if (!r.ok && classifyZernioFailure(r.failure) === "window_closed") {
      const plainText =
        media.attachmentUrl && media.attachmentType === "file"
          ? att.withFileLink(text, media.attachmentName ?? "file", media.attachmentUrl)
          : media.attachmentUrl
            ? `${text}\n${media.attachmentUrl}`.trim()
            : message;
      await replyOutsideWindow(ctx, customer, plainText, draftId);
      viaTemplate = true;
    }
    // Отказ Zernio уже объяснён словами продавца (describeSendError) — показываем его.
    if (!r.ok && !viaTemplate)
      throw r.error
        ? new UserError("err.admin.channelRefused", "Сообщение не ушло: {reason}", {
            reason: r.error,
          })
        : new UserError("err.admin.sendFailed", "Не удалось отправить сообщение");
  } else if (checked) {
    await att.sendTelegramAttachment(ctx, telegramId, text, checked);
  } else {
    const r = await api(ctx).call("sendMessage", {
      chat_id: telegramId,
      text,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
    if (!r.ok) throw att.telegramRefusal(r.description);
  }
  const { recordMessage } = await import("@/core/chat/chat");
  await recordMessage(ctx, {
    telegramId,
    direction: "out",
    sender: "manager",
    text: attachment ? att.attachmentLogText(attachment, text) : text,
  });
}

/**
 * Ответ из «Чата» после 24 часов тишины покупателя. WhatsApp пускает только
 * одобренный шаблон: текст продавца уходит его параметром (одной строкой,
 * ограничения Meta — channels/zernio/outbox templateParam). Шаблона нет —
 * объясняем, где его задать. Instagram шаблонов не знает: написать можно,
 * только когда покупатель напишет сам; даём ссылку на страницу его заказа,
 * чтобы продавец отправил её другим путём.
 */
async function replyOutsideWindow(
  ctx: TenantContext,
  customer: import("@/core/customers/customers").Customer,
  text: string,
  draftId?: string,
): Promise<void> {
  if (customer.platform === "whatsapp") {
    const { getSetting } = await import("@/core/settings/settings");
    const { parseNotifyTemplate, templateParam } = await import("@/channels/zernio/outbox.server");
    const tpl = parseNotifyTemplate(await getSetting(ctx, "whatsapp_bot_notify_template"));
    if (!tpl) throw new UserError("err.admin.waWindowNoTemplate", WA_TEMPLATE_MISSING);
    if (!customer.contactPhone)
      throw new UserError(
        "err.admin.waNoPhone",
        "Прошло больше 24 часов с последнего сообщения покупателя, а его номера нет — шаблон отправить некуда.",
      );
    const { describeSendError, startWhatsAppConversation } =
      await import("@/channels/zernio/api.server");
    const r = await startWhatsAppConversation({
      accountId: customer.zernioAccountId!,
      phone: customer.contactPhone,
      templateName: tpl.name,
      templateLanguage: tpl.language,
      templateParams: [templateParam(text)],
      ...(draftId ? { idempotencyScope: `chat-template:${draftId}` } : {}),
    });
    if (!r.ok)
      throw new UserError("err.admin.channelRefused", "Сообщение не ушло: {reason}", {
        reason: describeSendError("whatsapp", r.error, r.failure),
      });
    return;
  }
  const { listCustomerOrders } = await import("@/core/orders/orders");
  const { orderPageUrl } = await import("@/core/storefront/web-order");
  const [last] = await listCustomerOrders(ctx, customer, 1);
  const url = last ? await orderPageUrl(ctx, last.id) : null;
  throw url
    ? new UserError("err.admin.igWindowLink", IG_WINDOW_CLOSED + " Ссылка на его заказ: {url}", {
        url,
      })
    : new UserError("err.admin.igWindowClosed", IG_WINDOW_CLOSED);
}

const WA_TEMPLATE_MISSING =
  "Прошло больше 24 часов с последнего сообщения покупателя — WhatsApp разрешает писать только одобренным шаблоном. Задайте его: Настройки → «Автоответчик · WhatsApp» → «Шаблон для сообщений вне 24-часового окна».";
const IG_WINDOW_CLOSED =
  "Прошло больше 24 часов с последнего сообщения покупателя — Instagram не даёт написать ему первым. Ответ уйдёт, когда он напишет сам.";

/**
 * Продавец ответил из «Чата» — консультант молчит в этом диалоге столько,
 * сколько выбрано в его настройках. Раньше ответ из панели паузу не ставил,
 * и на следующее сообщение покупателя бот отвечал поверх продавца.
 */
export async function pauseBotAfterManagerReply(
  ctx: TenantContext,
  telegramId: number,
): Promise<void> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  if (!customer) return;
  const { pauseConsultant } = await import("@/core/consultant/engine.server");
  await pauseConsultant(ctx, customer);
}

async function notifyReferralGrant(
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
