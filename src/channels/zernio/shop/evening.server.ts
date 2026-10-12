/**
 * Вечерний срез AATeach 11.10: почта по желанию, чек текстом, повторное
 * «Купить», «отмена» сразу после заказа. Каждый ответ — с условной отметкой
 * до отправки (claimStateSection): двойной вебхук или восемь нажатий подряд
 * дают один ответ.
 */
import { claimStateSection } from "@/core/customers/customers";
import { getSetting } from "@/core/settings/settings";
import { CHAT_EMAIL_OPTIONAL_KEY, emailOptionalOn } from "@/core/orders/email-ask";
import {
  CHAT_RECEIPT_TEXT_KEY,
  looksLikeTextReceipt,
  mentionsAmount,
  receiptOperationNo,
  receiptTextOn,
} from "@/core/receipts/text-receipt";
import { displayNo, getOrder, recentAwaitingPaymentOrder, rejectOrder } from "@/core/orders/orders";
import { EVENING_COPY } from "./evening-copy";
import { BTN, reply, setMode, type Shop } from "./context.server";
import { receiveTextProof } from "./receipt.server";
import { triageOnce } from "./triage.server";

/** «Файлы придут сюда» — не чаще раза в 6 часов: дальше такие реплики читает продавец. */
export const FILES_HERE_WINDOW_MS = 6 * 3600_000;
/** Повторное «Купить»: один ответ «уже оформлен», дальше 30 минут молчим. */
export const REPEAT_BUY_WINDOW_MS = 30 * 60_000;
/** «Отмена» отменяет заказ, если он оформлен не раньше стольки минут назад. */
export const CANCEL_FRESH_MS = 30 * 60_000;

export async function emailOptional(s: Shop): Promise<boolean> {
  return emailOptionalOn(await getSetting(s.ctx, CHAT_EMAIL_OPTIONAL_KEY));
}

/**
 * «Вацап отправте» на вопрос о почте: файлы придут сюда, почта по желанию.
 * Почту больше не спрашиваем (email_skipped). false — уже отвечали недавно.
 */
export async function filesHereOnce(s: Shop): Promise<boolean> {
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const at = Date.parse(String(cur.files_here_at ?? ""));
    if (Number.isFinite(at) && Date.now() - at < FILES_HERE_WINDOW_MS) return null;
    return { ...cur, files_here_at: new Date().toISOString(), email_skipped: true };
  });
  if (!claimed) return false;
  s.customer = claimed;
  await reply(s, EVENING_COPY[s.locale].filesHere, { force: true });
  return true;
}

const PAY_MODES = ["awaiting_proof", "awaiting_payment", "choose_pay"];

/**
 * Текст чека из банковского приложения на шаге оплаты или по свежему
 * неоплаченному заказу: заказ — продавцу на проверку. false — не чек, или
 * продавец выключил «Принимать чек текстом», или заказа нет.
 */
export async function textReceipt(
  s: Shop,
  mode: string | undefined,
  text: string,
): Promise<boolean> {
  const byWords = looksLikeTextReceipt(text);
  if (!byWords && !(mentionsAmount(text) && text.trim().length >= 12)) return false;
  if (!receiptTextOn(await getSetting(s.ctx, CHAT_RECEIPT_TEXT_KEY))) return false;
  const pending = s.customer.state.pending_order_id;
  let orderId = mode && PAY_MODES.includes(mode) && pending ? Number(pending) : null;
  if (!orderId) orderId = await recentAwaitingPaymentOrder(s.ctx, s.customer);
  if (!orderId) return false;
  // Слов чека нет, а сумма есть — уведомление ли это банка, решает модель
  // (Копилка 12.10, taurgalievna #148: «Покупка: 1 700 ₸ / ИП КОПИЛКА
  // РУСОВЕДА / Доступно: …» — бот промолчал, деньги пришли).
  if (!byWords && (await triageOnce(s, text))?.kind !== "text_receipt") return false;
  s.why = "чек текстом — продавцу на проверку";
  await receiveTextProof(s, orderId, text, receiptOperationNo(text));
  return true;
}

/**
 * Повторное «Купить» того же товара, пока заказ ждёт оплаты: первый повтор —
 * «Заказ #N уже оформлен» (при выборе способа оплаты — снова кнопки оплаты),
 * следующие 30 минут — тишина. zuxra6163 нажала 8 раз и получила 8 одинаковых
 * «Заказ #1415 оформлен» (AATeach 11.10). true — ответили или промолчали;
 * false — повтор вне окна, пусть уходит полное сообщение с оплатой.
 */
export async function repeatBuy(
  s: Shop,
  orderId: number,
  no: number,
  resend: () => Promise<boolean>,
): Promise<boolean> {
  const mode = s.customer.state.mode;
  let fresh = true;
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const r = cur.repeat_buy as { order?: number; at?: string } | undefined;
    const at = Date.parse(String(r?.at ?? ""));
    if (r?.order === orderId && Number.isFinite(at) && Date.now() - at < REPEAT_BUY_WINDOW_MS)
      return null;
    fresh = r?.order !== orderId;
    return { ...cur, repeat_buy: { order: orderId, at: new Date().toISOString() } };
  });
  if (!claimed) return true;
  s.customer = claimed;
  // Окно прошло — покупатель мог потерять сообщение: полностью, как раньше.
  if (!fresh) return resend();
  if (mode === "choose_pay") return resend();
  const t = EVENING_COPY[s.locale];
  await reply(s, mode === "awaiting_payment" ? t.alreadyPlacedLink(no) : t.alreadyPlacedProof(no), {
    force: true,
  });
  return true;
}

/**
 * «Отмена» сразу после оформления: свежий заказ без чека отменяется (остаток
 * и баллы возвращает rejectOrder). vagflay написала «Отмена» после #1396 —
 * бот показал меню, заказ висел. false — отменять нечего, обычный выход из шага.
 */
export async function cancelFreshOrder(s: Shop): Promise<boolean> {
  const mode = s.customer.state.mode;
  const id = Number(s.customer.state.pending_order_id);
  if (!mode || !PAY_MODES.includes(mode) || !id) return false;
  const order = await getOrder(s.ctx, id);
  if (
    !order ||
    order.telegram_id !== s.customer.telegramId ||
    order.status !== "awaiting_payment" ||
    order.payment_proof_path ||
    !(Date.now() - Date.parse(order.created_at) < CANCEL_FRESH_MS)
  )
    return false;
  const done = await rejectOrder(s.ctx, id, "buyer", {
    from: ["awaiting_payment"],
    to: "cancelled",
  });
  if (!done) return false;
  await setMode(s, { mode: "idle", pending_order_id: undefined, pending_display_no: undefined });
  s.why = "покупатель отменил свежий заказ";
  await reply(s, EVENING_COPY[s.locale].orderCancelled(displayNo(order)), {
    force: true,
    buttons: [BTN.catalog(s.m)],
  });
  return true;
}
