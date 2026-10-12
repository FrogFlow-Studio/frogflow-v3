/**
 * Оплата и чеки в переписке — дневной срез AATeach 12.10, решения Якова 1–4.
 * Что написал покупатель, решает модель (core/inbox/triage, shop/triage),
 * а не список слов; код только исполняет:
 * 1. «Не проходит» (подписью к фото или следом за фото) — чек не принимается,
 *    заказ снова ждёт оплату, покупателю «попробуйте ещё раз или напишите
 *    банк», продавцу — уведомление. kopats23 #1435: фото и «Не проходит» →
 *    «✅ Чек получен», заказ 13 часов висел как оплаченный.
 * 2. Скриншот не отправляется — один раз на заказ предложить чек текстом
 *    (его принимает shop/evening.server). asya_6465 дважды получила
 *    инструкцию про скрепку, galinka.iva — тишину.
 * 3. Почта по заказу старше 14 дней — сначала спросить, тот ли заказ.
 *    yekaterina3107 получила сентябрьский #955 вместо «Частей речи».
 * 4. Номер товара сразу после заказа — сначала про ждущий оплаты заказ.
 *    tskhay_sasha после #1432 написала «3», бот открыл товар 003, а она
 *    оформила второй заказ #1434.
 * Каждый ответ — с условной отметкой до отправки: повтор события и два
 * сообщения подряд дают один ответ.
 */
import { claimStateSection } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { claimOrderEvent, listOrderEvents, recordOrderEvent } from "@/core/orders/events";
import {
  CHAT_FOREIGN_PAY_KEY,
  countryName,
  countryNameRu,
  foreignPayOn,
  kaspiForeignApplies,
} from "@/core/inbox/triage";
import {
  displayNo,
  getOrder,
  listActivePaymentMethods,
  recentAwaitingPaymentOrder,
  type OrderWithItems,
} from "@/core/orders/orders";
import { CHAT_RECEIPT_TEXT_KEY, receiptTextOn } from "@/core/receipts/text-receipt";
import {
  CHAT_UNPAID_NUMBER_KEY,
  PAY_FAILED_REPLY_MS,
  PROOF_WITHDRAW_MS,
  RESEND_ASK_MS,
  RESEND_OLD_CONFIRM_KEY,
  failedNearPhoto,
  isBareNumber,
  isOldOrder,
  isYes,
  resendOldConfirmOn,
  unpaidNumberOn,
} from "@/core/inbox/pay-chat";
import { serverFailure } from "@/lib/server-failure";
import { escapeHtml } from "@/channels/telegram/copy";
import { notifyAdminsHtml } from "@/channels/telegram/notify";
import { PLATFORM_LABEL } from "../platform";
import { isCancel } from "../flow/replies";
import { matchDirectCommand } from "../flow/commands";
import { SELLER_PROOF_WITHDRAWN } from "../phone-notice";
import { memory, reply, setMode, type Shop, type ShopOutcome } from "./context.server";
import { CANCEL_FRESH_MS } from "./evening.server";
import { triageOnce } from "./triage.server";

const PAY_MODES = ["awaiting_proof", "awaiting_payment", "choose_pay"];
const clip = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 300);
const msgAt = (s: Shop) => new Date(s.inboundAt ?? Date.now()).toISOString();

/** Заказ покупателя, который ждёт оплату или подтверждения чека; иначе null. */
async function payOrder(s: Shop): Promise<OrderWithItems | null> {
  const id =
    Number(s.customer.state.pending_order_id) ||
    (await recentAwaitingPaymentOrder(s.ctx, s.customer));
  if (!id) return null;
  const o = await getOrder(s.ctx, id);
  if (!o || o.telegram_id !== s.customer.telegramId) return null;
  return o.status === "awaiting_payment" || o.status === "awaiting_confirmation" ? o : null;
}

/** Чек этого заказа пришёл недавно (PROOF_WITHDRAW_MS) — его ещё можно снять. */
async function proofFresh(s: Shop, orderId: number): Promise<boolean> {
  const events = await listOrderEvents(s.ctx, orderId);
  const at = Date.parse(events.filter((e) => e.kind === "proof").at(-1)?.at ?? "");
  return Number.isFinite(at) && Date.now() - at < PROOF_WITHDRAW_MS;
}

/**
 * Снять чек: «ждёт подтверждения» → «ждёт оплату», только если статус ещё
 * тот (продавец мог успеть подтвердить). Файл чека остаётся в заказе:
 * продавец видит, что прислал покупатель. Продавцу — уведомление.
 */
async function withdrawProof(s: Shop, order: OrderWithItems, said: string): Promise<boolean> {
  const { data, error } = await s.ctx.db
    .from("orders")
    .update({
      status: "awaiting_payment",
      admin_note: `Покупатель написал, что платёж не прошёл: «${said}». Чек снят.`.slice(0, 500),
    })
    .eq("id", order.id)
    .eq("status", "awaiting_confirmation")
    .select("id");
  if (error) throw serverFailure(`Чек заказа #${order.id} не снят: ${error.message}`);
  if (!data?.length) return false;
  const no = displayNo(order);
  await recordOrderEvent(s.ctx, order.id, "proof_withdrawn", { text: said });
  await setMode(s, { mode: "awaiting_proof", pending_order_id: order.id, pending_display_no: no });
  const { sellerLocale } = await import("@/core/catalog/low-stock");
  const locale = await sellerLocale(s.ctx).catch(
    () => s.ctx.tenant.settings.default_locale ?? "ru",
  );
  const who = s.customer.username
    ? `@${s.customer.username}`
    : s.customer.firstName || s.customer.userKey;
  await notifyAdminsHtml(
    s.ctx,
    SELLER_PROOF_WITHDRAWN[locale](
      escapeHtml(who),
      PLATFORM_LABEL[s.platform],
      no,
      escapeHtml(said),
    ),
    { orderId: order.id, kind: "complaint" },
  ).catch(() => 0);
  return true;
}

/** «Похоже, платёж не прошёл…» — один раз на заказ в PAY_FAILED_REPLY_MS. */
async function payFailedReplyOnce(s: Shop, orderId: number): Promise<void> {
  s.handoff = true;
  s.why = "покупатель пишет, что платёж не прошёл — чек не принят, вопрос продавцу";
  const bucket = Math.floor(Date.now() / PAY_FAILED_REPLY_MS);
  if (await claimOrderEvent(s.ctx, orderId, "pay_failed", `reply:${bucket}`, { reply: true }))
    await reply(s, s.m.payFailedReply, { force: true });
}

/**
 * «Не получится» по заказу на Kaspi (способ оплаты Казахстана), а покупатель
 * из страны без своего способа оплаты (сам сказал раньше — direct.foreign_country,
 * или модель поняла из переписки): не «какой у вас банк», а «Kaspi принимает
 * только карты Казахстана, оплату из вашей страны подключаем» — один раз на
 * заказ (условная отметка до отправки), вопрос продавцу обращением. Копилка
 * 12.10, kramiliia #159: «Я с Кыргызстана» → «Перевод Kaspi» → «Не получится»
 * → «напишите, какой у вас банк». Выключается вместе с «Отвечать про оплату
 * из других стран». true — ответили (или уже отвечали по этому заказу).
 */
async function kaspiForeignReply(
  s: Shop,
  order: OrderWithItems,
  fromModel: string | null,
): Promise<boolean> {
  const remembered = memory(s.customer).foreign_country;
  const country = fromModel ?? (typeof remembered === "string" ? remembered : null);
  if (!country || order.country_code !== "KZ") return false;
  if (!foreignPayOn(await getSetting(s.ctx, CHAT_FOREIGN_PAY_KEY))) return false;
  // Способы оплаты не прочитались — не знаем, есть ли способ: прежний ответ.
  const methods = await listActivePaymentMethods(s.ctx).catch(() => null);
  if (!methods) return false;
  if (
    !kaspiForeignApplies(
      country,
      order.country_code,
      methods.map((m) => m.country_code),
    )
  )
    return false;
  s.handoff = true;
  s.why = `Kaspi не подходит покупателю из страны без способа оплаты (${countryNameRu(country)}) — ответили, вопрос продавцу`;
  if (
    await claimOrderEvent(s.ctx, order.id, "pay_failed", `foreign:${country}`, {
      country,
      reply: true,
    })
  )
    await reply(s, s.m.kaspiForeignReply(countryName(country, s.locale)), { force: true });
  return true;
}

/**
 * Шаг оплаты, «я из Кыргызстана», «не получается оплатить» (слова о
 * трудностях с оплатой, shop/flow/classify): заказ на Kaspi, а покупатель
 * из страны без своего способа оплаты — тот же честный ответ, что и на «Не
 * получится» (kaspiForeignReply), а не «передал продавцу». Страну называет
 * модель (из сообщения или переписки) или покупатель сказал её раньше.
 * true — ответили.
 */
export async function kaspiForeignTrouble(s: Shop, text: string): Promise<boolean> {
  const order = await payOrder(s);
  if (!order || order.status !== "awaiting_payment" || order.country_code !== "KZ") return false;
  const t = freeText(text) ? await triageOnce(s, text) : null;
  const said = t?.kind === "foreign_pay" || t?.kind === "payment_failed" ? t.country : null;
  if (said && said !== "KZ" && said !== "RU" && said !== memory(s.customer).foreign_country) {
    const saved = await claimStateSection(s.ctx, s.customer, "direct", (cur) =>
      cur.foreign_country === said ? null : { ...cur, foreign_country: said },
    ).catch(() => null);
    if (saved) s.customer = saved;
  }
  return kaspiForeignReply(s, order, said);
}

/** Свободный текст, а не номер, команда или почта: только его есть смысл разбирать моделью. */
function freeText(text: string): boolean {
  return (
    !isBareNumber(text) &&
    !text.includes("@") &&
    text.trim().length > 1 &&
    !isCancel(text) &&
    !matchDirectCommand(text)
  );
}

/**
 * Фото с подписью «не проходит» на шаге оплаты: это не чек. true — ответили,
 * реплика продавцу; чек не регистрируется.
 */
export async function payFailedCaption(s: Shop, orderId: number, text: string): Promise<boolean> {
  if (!freeText(text)) return false;
  const t = await triageOnce(s, text, true);
  if (t?.kind !== "payment_failed") return false;
  const order = await getOrder(s.ctx, orderId);
  if (!order) return false;
  await recordOrderEvent(s.ctx, orderId, "pay_failed", {
    text: clip(text),
    msg_at: msgAt(s),
    photo: true,
  });
  if (order.status === "awaiting_confirmation" && (await proofFresh(s, orderId)))
    await withdrawProof(s, order, clip(text));
  await payFailedReplyOnce(s, orderId);
  return true;
}

/**
 * Текст «не проходит» к заказу, ждущему оплату или подтверждения свежего
 * чека. Отметка — до проверки статуса: если фото обрабатывается в это же
 * время, его обработка увидит отметку (proofAfterPayFailed), а если чек уже
 * записан — его снимаем здесь. true — чек снят и ответ ушёл; false — пусть
 * реплику разбирает шаг оплаты (ответ «не прошёл» даст triageQuestion).
 */
export async function payFailedText(s: Shop, text: string): Promise<boolean> {
  if (!freeText(text)) return false;
  const order = await payOrder(s);
  if (!order) return false;
  if (order.status === "awaiting_confirmation" && !(await proofFresh(s, order.id))) return false;
  const t = await triageOnce(s, text);
  if (t?.kind !== "payment_failed") return false;
  await recordOrderEvent(s.ctx, order.id, "pay_failed", { text: clip(text), msg_at: msgAt(s) });
  const now = await getOrder(s.ctx, order.id);
  if (!now || now.status !== "awaiting_confirmation") return false;
  if (!(await withdrawProof(s, now, clip(text)))) return false;
  await payFailedReplyOnce(s, order.id);
  return true;
}

/**
 * Чек только что записан: если покупатель одновременно написал, что платёж
 * не прошёл, — снять его и не отвечать «Чек получен». true — снят.
 */
export async function proofAfterPayFailed(s: Shop, order: OrderWithItems): Promise<boolean> {
  const photoAt = s.inboundAt ?? Date.now();
  const events = await listOrderEvents(s.ctx, order.id);
  const said = events.find(
    (e) =>
      e.kind === "pay_failed" &&
      !e.payload.reply &&
      failedNearPhoto(typeof e.payload.msg_at === "string" ? e.payload.msg_at : null, photoAt),
  );
  if (!said) return false;
  const text = typeof said.payload.text === "string" ? said.payload.text : "";
  if (!(await withdrawProof(s, order, text))) return false;
  await payFailedReplyOnce(s, order.id);
  return true;
}

/**
 * Ответ разбора моделью на шаге оплаты или вне его (shop/triage):
 * payment_failed — «попробуйте ещё раз», cant_send_receipt — чек текстом.
 * null — заказа, ждущего оплату, нет: прежний путь.
 */
export async function payTroubleReply(
  s: Shop,
  kind: "payment_failed" | "cant_send_receipt",
  buyerCountry: string | null = null,
): Promise<ShopOutcome | null> {
  const order = await payOrder(s);
  if (!order || order.status !== "awaiting_payment") return null;
  if (kind === "payment_failed") {
    if (await kaspiForeignReply(s, order, buyerCountry)) return "question";
    await payFailedReplyOnce(s, order.id);
    return "question";
  }
  if (!receiptTextOn(await getSetting(s.ctx, CHAT_RECEIPT_TEXT_KEY))) return null;
  // Второй раз ту же подсказку не повторяем: дальше переписку ведёт продавец.
  if (!(await claimOrderEvent(s.ctx, order.id, "receipt_text_offered", "offer"))) {
    s.why = "скриншот снова не отправляется — подсказку уже давали, вопрос продавцу";
    return "question";
  }
  s.why = "скриншот не отправляется — предложили чек текстом";
  await reply(s, s.m.receiptTextOffer, { force: true });
  return "handled";
}

/**
 * Шаг оплаты: «скриншот не загружается», «можно на ватсап?» — раньше
 * инструкции про скрепку. null — это не то, разбираем дальше.
 */
export async function cantSendReceipt(s: Shop, text: string): Promise<ShopOutcome | null> {
  if (!freeText(text)) return null;
  if (!receiptTextOn(await getSetting(s.ctx, CHAT_RECEIPT_TEXT_KEY))) return null;
  const t = await triageOnce(s, text);
  if (t?.kind !== "cant_send_receipt") return null;
  return payTroubleReply(s, "cant_send_receipt");
}

/**
 * Голый номер в первые 30 минут после заказа, ждущего оплату (там же
 * работает «Отмена»): один раз на заказ — «Заказ #N ждёт оплату»; номер ещё
 * раз — обычный путь, к товару. true — ответили.
 */
export async function numberWhileUnpaid(s: Shop, text: string): Promise<boolean> {
  if (!isBareNumber(text)) return false;
  const mode = s.customer.state.mode;
  const id = Number(s.customer.state.pending_order_id);
  if (!mode || !PAY_MODES.includes(mode) || !id) return false;
  if (!unpaidNumberOn(await getSetting(s.ctx, CHAT_UNPAID_NUMBER_KEY))) return false;
  const order = await getOrder(s.ctx, id);
  if (
    !order ||
    order.telegram_id !== s.customer.telegramId ||
    order.status !== "awaiting_payment" ||
    order.payment_proof_path ||
    !(Date.now() - Date.parse(order.created_at) < CANCEL_FRESH_MS)
  )
    return false;
  if (!(await claimOrderEvent(s.ctx, id, "number_held", "once", { text: text.trim() })))
    return false;
  s.why = `номер товара, пока заказ №${displayNo(order)} ждёт оплату — сначала про заказ`;
  await reply(s, s.m.orderAwaitsPayment(String(displayNo(order))), { force: true });
  return true;
}

/**
 * ИИ после оплаты собирается отправить материалы ещё раз, а заказу больше
 * 14 дней: сначала спросить, тот ли это заказ. «handled» — спросили;
 * «question» — уже спрашивали только что, а в ответ не «да»: к продавцу;
 * null — заказ свежий или настройка выключена, отправляем как раньше.
 */
export async function askBeforeOldResend(
  s: Shop,
  order: OrderWithItems,
  email: string,
): Promise<ShopOutcome | null> {
  if (!isOldOrder(order.created_at)) return null;
  if (!resendOldConfirmOn(await getSetting(s.ctx, RESEND_OLD_CONFIRM_KEY))) return null;
  const now = new Date();
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const prev = cur.resend_ask as { order?: number; at?: string } | undefined;
    const at = Date.parse(String(prev?.at ?? ""));
    if (prev?.order === order.id && Number.isFinite(at) && now.getTime() - at < RESEND_ASK_MS)
      return null;
    return { ...cur, resend_ask: { order: order.id, email, at: now.toISOString() } };
  });
  // Уже спросили только что, а в ответ не «да» — это к продавцу.
  if (!claimed) return "question";
  s.customer = claimed;
  const date = new Date(order.created_at).toLocaleDateString("ru-RU", {
    timeZone: s.ctx.timezone,
    day: "2-digit",
    month: "2-digit",
  });
  const items = (order.order_items ?? []).map((i) => i.name_snapshot).join(", ");
  s.why = `заказ №${displayNo(order)} старше 14 дней — спросили, прислать ли его`;
  await recordOrderEvent(s.ctx, order.id, "resend_asked", { to: email });
  await reply(
    s,
    s.m.resendOldAsk(
      String(displayNo(order)),
      date,
      items.length > 120 ? `${items.slice(0, 120)}…` : items,
      email,
    ),
    { force: true },
  );
  return "handled";
}

/**
 * «Да» на вопрос о старом заказе: отправить письмо (ИИ после оплаты, тот же
 * путь с отметкой на 10 минут). Отметка снимается условной записью — два
 * «да» подряд дают одно письмо. null — вопроса не было или ответ не «да».
 */
export async function confirmOldResend(s: Shop, text: string): Promise<ShopOutcome | null> {
  const ask = memory(s.customer).resend_ask;
  if (!ask || !isYes(text)) return null;
  if (!(Date.now() - Date.parse(ask.at) < RESEND_ASK_MS)) return null;
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const curAsk = cur.resend_ask as { order?: number } | undefined;
    if (curAsk?.order !== ask.order) return null;
    return { ...cur, resend_ask: undefined };
  });
  if (!claimed) return "handled";
  s.customer = claimed;
  const order = await getOrder(s.ctx, ask.order);
  if (!order || order.telegram_id !== s.customer.telegramId) return null;
  const { resendConfirmed } = await import("./postpay.server");
  return resendConfirmed(s, order, ask.email);
}

/** Заказ шага оплаты уже оплачен — шаг оплаты больше ничего не ждёт. */
const PAID_STATUSES = ["paid", "delivering", "delivered"];

/**
 * Шаг оплаты остался, а заказ уже оплачен (Продамус, ApiPay, продавец
 * подтвердил): шаг снимается, реплику разбирает обычный путь — ИИ после
 * оплаты. _marina_lyalina_ (Копилка 12.10, #149) оплатила картой РФ, файлы
 * выданы, а «можно на почту?» и «не могу скачать по ссылкам» ушли в
 * обращение: шаг «жду оплату по ссылке» забирал реплику раньше ИИ.
 * true — шаг снят.
 */
export async function dropPaidStep(s: Shop): Promise<boolean> {
  const mode = s.customer.state.mode;
  const id = Number(s.customer.state.pending_order_id);
  if (!mode || !PAY_MODES.includes(mode) || !id) return false;
  const order = await getOrder(s.ctx, id);
  if (!order || order.telegram_id !== s.customer.telegramId) return false;
  if (!PAID_STATUSES.includes(order.status)) return false;
  await setMode(s, {
    mode: "idle",
    pending_order_id: undefined,
    pending_display_no: undefined,
    pay_link: undefined,
  });
  return true;
}

/**
 * «Как перейти на оплату?», «Каспий банк РК» в ответ на «какой у вас банк»
 * (разбор моделью — how_to_pay): ещё раз шаг оплаты выбранным способом —
 * реквизиты перевода или ссылка текстом. Раз в PAY_FAILED_REPLY_MS на заказ:
 * дальше такие реплики читает продавец. janat021265 (Копилка 12.10, #147)
 * после «Не получается» спросила, как оплатить, назвала банк — тишина.
 * null — заказа, ждущего оплату, нет или способ не понятен: прежний путь.
 */
export async function payHowToReply(s: Shop): Promise<ShopOutcome | null> {
  const order = await payOrder(s);
  if (!order || order.status !== "awaiting_payment") return null;
  const mode = s.customer.state.mode;
  const link = s.customer.state.pay_link;
  const kind =
    mode === "awaiting_proof"
      ? "manual"
      : mode === "awaiting_payment" && (link === "pdm" || link === "rk")
        ? link
        : null;
  if (!kind || Number(s.customer.state.pending_order_id) !== order.id) return null;
  const bucket = Math.floor(Date.now() / PAY_FAILED_REPLY_MS);
  if (!(await claimOrderEvent(s.ctx, order.id, "pay_howto", String(bucket)))) {
    s.why = "снова «как оплатить» — шаг оплаты уже повторяли, вопрос продавцу";
    return "question";
  }
  s.why = "покупатель спрашивает, как оплатить, — ещё раз шаг оплаты";
  const { choosePayment } = await import("./checkout.server");
  await choosePayment(s, kind, { asText: true });
  return "handled";
}
