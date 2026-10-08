// Сторона продавца: решения по заказу, шаги, ответы покупателю через бота.
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import { handoverAllowed } from "@/core/orders/handover";
import { orderChannel } from "@/core/orders/pure";
import { shopAdminIds } from "@/core/notify/recipients";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { TelegramApi } from "../api";
import type { TelegramMessage } from "../types";
import { COPY, escapeHtml } from "../copy";
import type { Locale } from "@/core/i18n/locale";
import { getCustomer } from "@/core/customers/customers";
import { deliverOrder, displayNo, getOrder, rejectOrder } from "@/core/orders/orders";
import { telegramLanguageAsker, telegramMaterialSender } from "../deliver";
import { notifyReferral } from "./orders";

export async function adminDecision(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
) {
  const admins = await shopAdminIds(ctx);
  // Ответы продавцу — на его языке; покупателю — на языке покупателя (m ниже).
  const { SELLER_DECISION } = await import("../seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const st = SELLER_DECISION[await sellerLocale(ctx)];
  if (!admins.includes(String(fromId))) {
    await api.call("sendMessage", { chat_id: chatId, text: st.onlyAdmin });
    return;
  }
  const orderId = Number(data.split(":")[1]);
  const order = await getOrder(ctx, orderId);
  if (!order)
    return void (await api.call("sendMessage", { chat_id: chatId, text: st.notFound(orderId) }));
  const no = displayNo(order);
  const buyerLocale: Locale = await orderBuyerLocale(ctx, order);
  const m = COPY[buyerLocale];
  // Покупатель из Instagram/WhatsApp — ответы и выдача уходят через Zernio.
  const { sendToZernioTarget, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const zernioTarget = await zernioTargetForOrder(ctx, order);
  const tellBuyer = async (text: string) => {
    if (zernioTarget) await sendToZernioTarget(zernioTarget, text);
    else if (orderChannel(order.platform) === "telegram")
      await api.call("sendMessage", { chat_id: order.telegram_id, text });
  };

  // Решение принято — кнопки уведомления у всех продавцов снимаем, через 5 минут
  // само уведомление уйдёт из чатов (как в v1).
  const { scheduleOrderNotifyDismiss } = await import("../order-notify");
  const decided = () => scheduleOrderNotifyDismiss(ctx, api, orderId);

  if (data.startsWith("reject:")) {
    const ok = await rejectOrder(ctx, orderId, "admin");
    await api.call("sendMessage", {
      chat_id: chatId,
      text: ok ? st.rejected(no) : st.alreadyClosed(no, order.status),
    });
    if (ok) await tellBuyer(m.orderRejected(no));
    await decided();
    return;
  }
  if (order.fulfillment_kind === "physical") {
    // Тот же путь, что и в админке: с чеком пишется задаток, повтор не двоит.
    const { acceptPhysicalOrder } = await import("@/core/orders/physical-admin");
    const r = await acceptPhysicalOrder(ctx, orderId, "admin");
    if (!r.ok) {
      await api.call("sendMessage", {
        chat_id: chatId,
        text: st.alreadyAcceptedOrClosed(no, order.status),
      });
      return;
    }
    await api.call("sendMessage", { chat_id: chatId, text: st.accepted(no) });
    await tellBuyer(m.orderAccepted(no));
    // Физический заказ ведётся дальше теми же сообщениями: кнопки следующего шага.
    const { refreshOrderNotifyButtons } = await import("../order-notify");
    const { orderStepKeyboard } = await import("../order-notify-keys");
    await refreshOrderNotifyButtons(
      ctx,
      api,
      orderId,
      orderStepKeyboard({ id: orderId, status: "accepted" }, await sellerLocale(ctx)),
    );
    return;
  }
  let sender = telegramMaterialSender(api, order.telegram_id, m);
  const web = orderChannel(order.platform) === "web";
  if (zernioTarget) {
    // Окно 24 часа закрыто — причину и ссылку на заказ продавец получит отдельным уведомлением.
    const { zernioDeliverySender } = await import("@/channels/zernio/outbound.server");
    sender = (await zernioDeliverySender(ctx, zernioTarget, order)).send;
  } else if (web) {
    // Заказ с сайта: материалы — на странице заказа и копией на почту.
    const { webMaterialSender } = await import("@/core/storefront/web-order");
    sender = webMaterialSender;
  } else if (orderChannel(order.platform) !== "telegram") {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: st.noDialog(no, order.platform),
    });
    return;
  }
  const r = await deliverOrder(
    ctx,
    orderId,
    sender,
    zernioTarget || web
      ? { lang: buyerLocale, allWhenAmbiguous: true, actor: "admin" }
      : {
          lang: buyerLocale,
          ask: telegramLanguageAsker(api, order.telegram_id, m),
          actor: "admin",
        },
  );
  // Частичная выдача возвращает заказ на проверку — там кнопки ещё нужны.
  if (r.failed === 0) await decided();
  if (r.alreadyDelivered)
    return void (await api.call("sendMessage", {
      chat_id: chatId,
      text: st.alreadyDelivered(no),
    }));
  if (r.failed === 0 && r.pending > 0)
    return void (await api.call("sendMessage", {
      chat_id: chatId,
      text: st.languageAsked(no, r.pending),
    }));
  if (r.failed === 0) {
    const { deliveredMessage } = await import("@/core/delivery/note.server");
    await tellBuyer(await deliveredMessage(ctx, order.platform, m.orderDelivered(no)));
    if (r.pointsEarned > 0) await tellBuyer(m.pointsEarned(r.pointsEarned));
    await notifyReferral(ctx, api, r.referral);
    await api.call("sendMessage", {
      chat_id: chatId,
      text: st.delivered(no, r.sent),
    });
  } else {
    await api.call("sendMessage", {
      chat_id: chatId,
      text: st.partial(no, r.sent, r.failed),
    });
  }
}

/**
 * Кнопки шага физического заказа («В работу», «Собран», «Отправлен», «Выдан»)
 * и «Написать покупателю» под уведомлением продавцу. Шаг — тот же
 * setPhysicalStatus, что и в админке, условная запись по статусу: двойное
 * нажатие или кнопка устаревшего статуса ничего не пишут и не шлют.
 */
export async function adminOrderButton(
  ctx: TenantContext,
  api: TelegramApi,
  fromId: number,
  chatId: number,
  data: string,
) {
  const { shopAdminIds } = await import("@/core/notify/recipients");
  const { SELLER_DECISION } = await import("../seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const sLocale = await sellerLocale(ctx);
  const st = SELLER_DECISION[sLocale];
  const say = (text: string) => api.call("sendMessage", { chat_id: chatId, text });
  if (!(await shopAdminIds(ctx)).includes(String(fromId))) return void (await say(st.onlyAdmin));
  const [kind, idRaw, stepRaw] = data.split(":");
  const orderId = Number(idRaw);
  const order = Number.isInteger(orderId) ? await getOrder(ctx, orderId) : null;
  if (!order) return void (await say(st.notFound(orderId)));
  const no = displayNo(order);

  if (kind === "owr") {
    if (orderChannel(order.platform) === "manual" || orderChannel(order.platform) === "web")
      return void (await say(st.writeNoChat(no)));
    const { orderWriteRefLine } = await import("../order-notify-keys");
    await say(`${st.writePrompt(no)}\n${orderWriteRefLine(orderId)}`);
    return;
  }

  if (kind === "otr") {
    if (order.fulfillment_kind !== "physical" || !["ready", "delivered"].includes(order.status))
      return void (await say(st.trackNeedReady(no, order.status)));
    // Самовывоз не отправляют: трека нет (Х4).
    if (!handoverAllowed(order.fulfillment_type, "shipped"))
      return void (await say(st.stepStale(no, order.status)));
    const { orderTrackRefLine } = await import("../order-notify-keys");
    await say(`${st.trackPrompt(no)}\n${orderTrackRefLine(orderId)}`);
    return;
  }

  const { isOrderStep, ORDER_STEPS } = await import("../order-notify-keys");
  if (!stepRaw || !isOrderStep(stepRaw) || order.fulfillment_kind !== "physical")
    return void (await say(st.stepStale(no, order.status)));
  const { from, to } = ORDER_STEPS[stepRaw];
  // Доставка закрывается «Отправлен», самовывоз — «Выдан»: чужая кнопка (устаревшее сообщение) — отказ (Х4).
  if (
    (stepRaw === "shipped" || stepRaw === "done") &&
    !handoverAllowed(order.fulfillment_type, stepRaw)
  )
    return void (await say(st.stepStale(no, order.status)));
  const { setPhysicalStatus } = await import("@/core/orders/admin");
  // Условная запись: выигрывает одно нажатие, остальные видят «статус уже изменился».
  if (!(await setPhysicalStatus(ctx, orderId, from, to)))
    return void (await say(st.stepStale(no, order.status)));
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(ctx, orderId, "status", { to, step: stepRaw }, "admin");
  const m = COPY[await orderBuyerLocale(ctx, order)];
  const { sendToZernioTarget, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order);
  const notice = stepRaw === "shipped" ? m.orderShipped(no) : m.orderStatusNotice(to, no);
  if (target) await sendToZernioTarget(target, notice);
  else if (orderChannel(order.platform) === "telegram")
    await api.call("sendMessage", { chat_id: order.telegram_id, text: notice });
  await say(st.stepDone(no, stepRaw));
  await afterOrderStep(ctx, api, order, to, sLocale);
}

/** После шага: кнопки следующего шага, а у выданного — снять уведомление и наградить пригласившего. */
async function afterOrderStep(
  ctx: TenantContext,
  api: TelegramApi,
  order: NonNullable<Awaited<ReturnType<typeof getOrder>>>,
  to: string,
  sLocale: Locale,
) {
  const orderId = order.id;
  const no = displayNo(order);
  const { orderStepKeyboard } = await import("../order-notify-keys");
  const { refreshOrderNotifyButtons, scheduleOrderNotifyDismiss } = await import("../order-notify");
  const keyboard = orderStepKeyboard(
    { id: orderId, status: to, fulfillment_type: order.fulfillment_type },
    sLocale,
  );
  if (keyboard.length) await refreshOrderNotifyButtons(ctx, api, orderId, keyboard);
  else {
    await scheduleOrderNotifyDismiss(ctx, api, orderId);
    // Выдан — как в админке: награда пригласившему за первую выдачу.
    const { rewardReferrerIfFirstDelivery } = await import("@/core/referrals/referrals");
    const grant = await rewardReferrerIfFirstDelivery(ctx, order.telegram_id).catch((e) => {
      console.error(`[tg] награда пригласившему, заказ #${no}: ${String(e)}`);
      return null;
    });
    await notifyReferral(ctx, api, grant);
  }
}

/**
 * Ответ продавца свайпом на «Написать покупателю»: текст уходит покупателю в
 * его канал. Instagram/WhatsApp вне окна 24 часа — честный отказ, не повтор.
 * false — это не такой ответ.
 */
export async function relayOrderReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const { orderWriteRefOf } = await import("../order-notify-keys");
  const orderId = orderWriteRefOf(msg.reply_to_message?.text);
  if (!orderId || !msg.from) return false;
  const { shopAdminIds } = await import("@/core/notify/recipients");
  if (!(await shopAdminIds(ctx)).includes(String(msg.from.id))) return false;
  const { SELLER_DECISION } = await import("../seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const st = SELLER_DECISION[await sellerLocale(ctx)];
  const say = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  const order = await getOrder(ctx, orderId);
  if (!order) {
    await say(st.notFound(orderId));
    return true;
  }
  const no = displayNo(order);
  const text = msg.text!.trim();
  const { sendToZernioTargetResult, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order);
  if (target) {
    const { relayToBuyer } = await import("../relay-send");
    const out = await relayToBuyer(
      () => sendToZernioTargetResult(target, escapeHtml(text)),
      target.platform,
      st,
    );
    await say(out.ok ? st.writeSent(no) : out.say);
    return true;
  }
  if (orderChannel(order.platform) !== "telegram") {
    await say(st.writeNoChat(no));
    return true;
  }
  const res = await api.call("sendMessage", { chat_id: order.telegram_id, text });
  await say(res.ok ? st.writeSent(no) : st.writeNotSent);
  return true;
}

/**
 * Ответ продавца свайпом на «Отправлен + трек»: номер (или ссылка) → заказ
 * «отправлен» и один раз сообщение покупателю с номером и ссылкой по формату.
 * Заказ собран — шаг делает условная запись, как у кнопки; «один раз» держит
 * запись события по номеру: тот же номер второй раз не уходит, исправленный — уходит.
 * false — это не такой ответ.
 */
export async function trackReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const { orderTrackRefOf } = await import("../order-notify-keys");
  const orderId = orderTrackRefOf(msg.reply_to_message?.text);
  if (!orderId || !msg.from) return false;
  const { shopAdminIds } = await import("@/core/notify/recipients");
  if (!(await shopAdminIds(ctx)).includes(String(msg.from.id))) return false;
  const { SELLER_DECISION } = await import("../seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const sLocale = await sellerLocale(ctx);
  const st = SELLER_DECISION[sLocale];
  const say = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  const order = await getOrder(ctx, orderId);
  if (!order) {
    await say(st.notFound(orderId));
    return true;
  }
  const no = displayNo(order);
  const { trackingFromText, trackingKey, trackingMessage, trackingPayload } =
    await import("@/core/orders/tracking");
  const track = trackingFromText(msg.text);
  if (!track) {
    await say(st.trackBad);
    return true;
  }
  if (
    order.fulfillment_kind !== "physical" ||
    (order.status !== "ready" && order.status !== "delivered")
  ) {
    await say(st.trackNeedReady(no, order.status));
    return true;
  }
  if (!handoverAllowed(order.fulfillment_type, "shipped")) {
    await say(st.stepStale(no, order.status));
    return true;
  }
  const { recordOrderEvent, claimOrderEvent } = await import("@/core/orders/events");
  if (order.status === "ready") {
    const { setPhysicalStatus } = await import("@/core/orders/admin");
    if (await setPhysicalStatus(ctx, orderId, "ready", "delivered")) {
      await recordOrderEvent(ctx, orderId, "status", { to: "delivered", step: "shipped" }, "admin");
      await afterOrderStep(ctx, api, order, "delivered", sLocale);
    }
  }
  const label = track.number ?? track.url ?? "";
  // «Один раз»: запись события до отправки; второй такой же ответ ничего не шлёт.
  if (
    !(await claimOrderEvent(
      ctx,
      orderId,
      "tracking",
      trackingKey(track),
      trackingPayload(track),
      "admin",
    ))
  ) {
    await say(st.trackAlready(no, label));
    return true;
  }
  const text = trackingMessage(await orderBuyerLocale(ctx, order), no, track);
  const { sendToZernioTargetResult, zernioTargetForOrder } =
    await import("@/channels/zernio/outbound.server");
  const target = await zernioTargetForOrder(ctx, order);
  if (target) {
    const { relayToBuyer } = await import("../relay-send");
    const out = await relayToBuyer(
      () => sendToZernioTargetResult(target, escapeHtml(text)),
      target.platform,
      st,
    );
    await say(out.ok ? st.trackSent(no, label) : out.say);
  } else if (orderChannel(order.platform) === "telegram") {
    const res = await api.call("sendMessage", { chat_id: order.telegram_id, text });
    await say(res.ok ? st.trackSent(no, label) : st.writeNotSent);
  } else await say(st.trackNoChat(no));
  return true;
}

/**
 * Ответ продавца на уведомление «Клиент ждёт менеджера» (core/consultant/relay):
 * метка в тексте уведомления → покупатель → сообщение ему в Instagram/WhatsApp.
 * false — это не такой ответ, сообщение обрабатывается как обычно.
 */
export async function relayManagerReply(
  ctx: TenantContext,
  api: TelegramApi,
  msg: TelegramMessage,
): Promise<boolean> {
  const { handoffRefOf, resolveHandoffRef } = await import("@/core/consultant/relay");
  const token = handoffRefOf(msg.reply_to_message?.text ?? msg.reply_to_message?.caption);
  if (!token || !msg.from) return false;
  const { shopAdminIds } = await import("@/core/notify/recipients");
  if (!(await shopAdminIds(ctx)).includes(String(msg.from.id))) return false;
  const { SELLER_DECISION } = await import("../seller-decision-texts");
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const st = SELLER_DECISION[await sellerLocale(ctx)];
  const reply = (text: string) => api.call("sendMessage", { chat_id: msg.chat.id, text });
  const userKey = await resolveHandoffRef(ctx, token);
  const buyer = userKey ? await getCustomer(ctx, userKey) : null;
  const { sendToZernioTargetResult, zernioTargetOf } =
    await import("@/channels/zernio/outbound.server");
  const target = zernioTargetOf(buyer);
  if (!buyer || !target) {
    await reply(st.relayNoDialog);
    return true;
  }
  const text = msg.text!.trim();
  const { relayToBuyer } = await import("../relay-send");
  const out = await relayToBuyer(
    () => sendToZernioTargetResult(target, escapeHtml(text)),
    target.platform,
    st,
  );
  if (!out.ok) {
    await reply(out.say);
    return true;
  }
  const { recordRelayedReply } = await import("@/core/consultant/engine.server");
  await recordRelayedReply(ctx, buyer, text);
  // Менеджер ответил сам — его задача в админке сделана (v1 manager-reply.ts).
  const { closeTaskAfterReply } = await import("@/core/consultant/tasks");
  await closeTaskAfterReply(ctx, buyer.userKey, new Date(), { via: "telegram" });
  if (ctx.tenant.modules.manager_chat) {
    const { recordMessage } = await import("@/core/chat/chat");
    await recordMessage(ctx, {
      telegramId: buyer.telegramId,
      direction: "out",
      sender: "manager",
      text,
    }).catch(() => {});
  }
  await reply(st.relaySent);
  return true;
}
