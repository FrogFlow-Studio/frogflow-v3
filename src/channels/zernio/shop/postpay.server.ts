/**
 * ИИ после оплаты в переписке (core/postpay): «отправьте на почту», «не
 * пришло», новая почта — ответ по фактам заказа вместо «передал продавцу».
 * null — не про полученный заказ, сообщение идёт прежним путём.
 */
import { isMailConfigured } from "@/core/mail/mail.server";
import { setEmail } from "@/core/customers/customers";
import { claimOrderEvent } from "@/core/orders/events";
import { getOrder } from "@/core/orders/orders";
import { POSTPAY_TEXT, RESEND_BUCKET_MS, planStep, type PostPayStep } from "@/core/postpay/postpay";
import { reply, setMode, type Shop, type ShopOutcome } from "./context.server";
import { mentionsEmail } from "@/core/orders/email-ask";
import { emailOptional, filesHereOnce } from "./evening.server";

export async function postPayAssist(s: Shop, text: string): Promise<ShopOutcome | null> {
  const { decidePostPay, postpayFacts, postpayOrder } =
    await import("@/core/postpay/decide.server");
  const order = await postpayOrder(s.ctx, s.customer).catch((e) => {
    console.warn(`[postpay:${s.ctx.tenant.id}] ${String(e)}`);
    return null;
  });
  if (!order) return null;
  if (!(s.transport.mailReady ?? isMailConfigured)()) return null;
  const facts = await postpayFacts(s.ctx, order);
  const decision = await decidePostPay(s.ctx, { customer: s.customer, facts, text });
  const step = planStep(decision, facts);
  if (step.kind === "pass") return null;
  s.why = `ИИ после оплаты (заказ №${facts.orderNo}): ${WHY[step.kind]}`;
  const t = POSTPAY_TEXT[s.locale];
  switch (step.kind) {
    case "ask_email":
      // Почта по желанию: «Отправьте материал, который оплатила» — это не
      // просьба о письме, почту не спрашиваем (AATeach 11.10, ryskul_kussainova).
      if (!mentionsEmail(text) && (await emailOptional(s))) {
        if (facts.status === "delivered") return null;
        return (await filesHereOnce(s)) ? "handled" : "question";
      }
      await setMode(s, { mode: "awaiting_order_email", pending_order_id: order.id });
      await reply(s, t.askEmail(facts.orderNo), { force: true });
      return "handled";
    case "told_sent":
      await reply(s, t.toldSent(step.email, when(s, step.at)), { force: true });
      return "handled";
    case "pending":
      await reply(s, t.pending(step.email), { force: true });
      return "handled";
    case "save_for_later":
      if (!(await saveEmail(s, order.id, step.email))) return null;
      await reply(s, t.saved(step.email), { force: true });
      return "handled";
    case "limit":
      // Много писем подряд — пусть посмотрит продавец.
      return "question";
    case "send":
      return resend(s, order.id, step);
  }
}

const WHY: Record<PostPayStep["kind"], string> = {
  pass: "не про заказ",
  ask_email: "просит на почту, почты нет — спросили",
  told_sent: "письмо уже ушло — сказали куда",
  pending: "оплата ещё не подтверждена",
  save_for_later: "новая почта до выдачи — записали",
  limit: "писем уже много — продавцу",
  send: "отправили письмо ещё раз",
};

function when(s: Shop, iso: string): string {
  return new Date(iso).toLocaleString(s.locale === "en" ? "en-GB" : "ru-RU", {
    timeZone: s.ctx.timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function saveEmail(s: Shop, orderId: number, email: string): Promise<boolean> {
  try {
    const { setOrderEmail } = await import("@/core/orders/deliver-order");
    await setOrderEmail(s.ctx, orderId, s.customer.telegramId, email);
    s.customer = await setEmail(s.ctx, s.customer, email);
    return true;
  } catch (e) {
    console.error(`[postpay:${s.ctx.tenant.id}] почта заказа #${orderId}: ${String(e)}`);
    return false;
  }
}

/**
 * Письмо ещё раз. Отметка — до отправки и условной записью: два сообщения
 * подряд, повтор события или двойной вебхук дают одно письмо на 10 минут.
 */
async function resend(
  s: Shop,
  orderId: number,
  step: Extract<PostPayStep, { kind: "send" }>,
): Promise<ShopOutcome> {
  if (step.fresh && !(await saveEmail(s, orderId, step.email))) return "question";
  const bucket = Math.floor(Date.now() / RESEND_BUCKET_MS);
  const won = await claimOrderEvent(s.ctx, orderId, "email_resend", String(bucket), {
    to: step.email,
  });
  const t = POSTPAY_TEXT[s.locale];
  // Проиграли гонку: письмо уже уходит по соседнему сообщению.
  if (!won) return "handled";
  const fresh = await getOrder(s.ctx, orderId);
  if (!fresh) return "question";
  const { emailOrderMaterials } = await import("@/core/orders/email");
  const r = await emailOrderMaterials(s.ctx, fresh, s.transport.mailer).catch((e) => ({
    sent: false,
    reason: String(e),
  }));
  if (!r.sent) {
    console.warn(`[postpay:${s.ctx.tenant.id}] письмо по заказу #${orderId}: ${r.reason}`);
    return "question";
  }
  await reply(s, t.sent(step.email), { force: true });
  return "handled";
}
