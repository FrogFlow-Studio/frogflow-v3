/**
 * Свободная реплика, на которую у магазина нет ответа, перед обращением
 * продавцу (core/inbox/triage): «спасибо», эмодзи, «+» — без обращения и без
 * ответа; вопрос об оплате из страны, для которой у магазина нет способа
 * оплаты, — один честный ответ в сутки и обращение продавцу.
 * null — прежний путь (обращение и, где включено, «передал продавцу»).
 */
import { claimStateSection } from "@/core/customers/customers";
import { listActivePaymentMethods } from "@/core/orders/orders";
import { foreignPayApplies, countryNameRu, type Triage } from "@/core/inbox/triage";
import { triageMessage } from "@/core/inbox/triage.server";
import { reply, type Shop, type ShopOutcome } from "./context.server";

/** Ответ «оплату из вашей страны подключаем» — не чаще раза в это время. */
export const FOREIGN_PAY_REPLY_MS = 24 * 60 * 60_000;

/**
 * Разбор реплики моделью — один раз на сообщение: шаг оплаты, «платёж не
 * прошёл» и обращение продавцу спрашивают одно и то же. null — сбой.
 */
export function triageOnce(s: Shop, text: string, withPhoto = false): Promise<Triage | null> {
  const key = `${withPhoto ? "photo" : "text"}:${text}`;
  if (s.triaged?.key === key) return s.triaged.result;
  const result = triageMessage(s.ctx, { customer: s.customer, text, withPhoto }).catch((e) => {
    console.warn(`[triage:${s.ctx.tenant.id}] ${String(e)}`);
    return null;
  });
  s.triaged = { key, result };
  return result;
}

export async function triageQuestion(s: Shop, text: string): Promise<ShopOutcome | null> {
  const t = await triageOnce(s, text);
  if (!t || t.kind === "other") return null;
  // Платёж не прошёл, скриншот не отправляется — про заказ, ждущий оплаты (AATeach 12.10).
  if (t.kind === "payment_failed" || t.kind === "cant_send_receipt") {
    const { payTroubleReply } = await import("./pay-trouble.server");
    return payTroubleReply(s, t.kind);
  }
  // «Как перейти на оплату?», банк в ответ на «какой у вас банк» — шаг оплаты ещё раз (Копилка 12.10).
  if (t.kind === "how_to_pay") {
    const { payHowToReply } = await import("./pay-trouble.server");
    return payHowToReply(s);
  }
  // Текст чека принимает шаг оплаты раньше (shop/evening, textReceipt); здесь — прежний путь.
  if (t.kind === "text_receipt") return null;
  if (t.kind === "chatter") {
    // Сообщение остаётся в «Чате»; бот молчит, обращения нет (Копилка 12.10:
    // «Благодарю! 🌹» открывало обращение #123).
    console.info(`[triage:${s.ctx.tenant.id}] ${s.customer.userKey}: без вопроса — без обращения`);
    return "handled";
  }
  // Чтение способов оплаты не удалось — не знаем, есть ли способ: прежний путь.
  const methods = await listActivePaymentMethods(s.ctx).catch(() => null);
  if (!methods) return null;
  if (
    !foreignPayApplies(
      t,
      methods.map((m) => m.country_code),
    )
  )
    return null;
  // Один ответ в сутки: отметка — условной записью до отправки. Вместе с ней
  // forwarded_at: «Передал ваш вопрос продавцу» (handle-message) вторым
  // сообщением не уйдёт.
  const now = new Date();
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const at = Date.parse(String(cur.foreign_pay_at ?? ""));
    if (Number.isFinite(at) && now.getTime() - at < FOREIGN_PAY_REPLY_MS) return null;
    return { ...cur, foreign_pay_at: now.toISOString(), forwarded_at: now.toISOString() };
  }).catch((e) => {
    console.warn(`[triage:${s.ctx.tenant.id}] отметка оплаты из-за рубежа: ${String(e)}`);
    return null;
  });
  // Уже отвечали сегодня (или отметку не поставить): вопрос продавцу молча.
  if (!claimed) return "question";
  s.customer = claimed;
  s.handoff = true;
  s.why = `оплата из страны без способа оплаты (${countryNameRu(t.country!)}) — ответили, вопрос продавцу`;
  await reply(s, s.m.foreignPayReply, { force: true });
  return "question";
}
