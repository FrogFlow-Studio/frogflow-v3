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
import type { DmButton } from "../api.server";
import { BTN, reply, type Shop, type ShopOutcome } from "./context.server";

/** Ответ «оплату из вашей страны подключаем» — не чаще раза в это время. */
export const FOREIGN_PAY_REPLY_MS = 24 * 60 * 60_000;
/** «Нажмите «Купить»» на «как получить?» — не чаще раза в это время. */
export const HOW_TO_BUY_REPLY_MS = 30 * 60_000;
/** «Вопрос у продавца» на «несколько одним чеком» и название без товара — раз в это время. */
export const SELLER_QUESTION_REPLY_MS = 24 * 60 * 60_000;
/** Вторая такая реплика раньше этого — продолжение первой, ей ответ уже ушёл. */
const HOW_TO_BUY_BURST_MS = 2 * 60_000;

/** Кто пишет: по нему находится кнопка «Купить», ушедшая ему в Direct. */
export type Sender = { username?: string | null; senderId?: string | null };

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

export async function triageQuestion(
  s: Shop,
  text: string,
  who?: Sender,
): Promise<ShopOutcome | null> {
  const t = await triageOnce(s, text);
  if (!t || t.kind === "other") return null;
  if (t.kind === "how_to_buy") return howToBuyReply(s, who);
  // «Можно 2 материала одним чеком?» (Копилка 13.10, gvar41391 #190 — тишина).
  if (t.kind === "several_items")
    return sellerQuestionReply(
      s,
      "several_items_at",
      s.m.severalItemsReply,
      [],
      "несколько материалов одним заказом или чеком — ответили, вопрос продавцу",
    );
  // «Классный уголок» четыре раза, правила и товара нет (Копилка 13.10 — тишина).
  if (t.kind === "product_request") {
    // Если включён ИИ-консультант — отдаём вопрос ему: он ищет по каталогу и консультирует клиента.
    const consultant = await import("@/core/consultant/engine.server");
    if (await consultant.consultantEnabled(s.ctx)) return null;
    // Без каталога звать некуда: прежний путь.
    if (!s.bot.features.catalog) return null;
    return sellerQuestionReply(
      s,
      "product_request_at",
      s.m.productRequestReply,
      [BTN.catalog(s.m)],
      "материал по названию не нашёлся — ответили, вопрос продавцу, кнопка «Каталог»",
    );
  }
  // Платёж не прошёл, скриншот не отправляется — про заказ, ждущий оплаты (AATeach 12.10).
  if (t.kind === "payment_failed" || t.kind === "cant_send_receipt") {
    const { payTroubleReply } = await import("./pay-trouble.server");
    return payTroubleReply(s, t.kind, t.country);
  }
  // «Как перейти на оплату?», банк в ответ на «какой у вас банк» — шаг оплаты ещё раз (Копилка 12.10).
  if (t.kind === "how_to_pay") {
    const { payHowToReply } = await import("./pay-trouble.server");
    return payHowToReply(s);
  }
  // Текст чека принимает шаг оплаты раньше (shop/evening, textReceipt); здесь — прежний путь.
  if (t.kind === "text_receipt") return null;
  if (t.kind === "chatter") {
    // Если включён ИИ-консультант и у клиента есть недавний диалог с ним — передаём консультанту,
    // чтобы не обрывать диалог на согласии клиента («да», «оплачу», «вечером» и т.п.)
    const consultant = await import("@/core/consultant/engine.server");
    if (await consultant.consultantEnabled(s.ctx)) {
      const recent = (s.customer.state as { consultant?: { recent?: unknown[] } })?.consultant?.recent;
      if (Array.isArray(recent) && recent.length > 0) {
        return null;
      }
    }
    // Сообщение остаётся в «Чате»; бот молчит, обращения нет (Копилка 12.10:
    // «Благодарю! 🌹» открывало обращение #123).
    console.info(`[triage:${s.ctx.tenant.id}] ${s.customer.userKey}: без вопроса — без обращения`);
    return "handled";
  }
  // Если у магазина есть Робокасса — зарубежные карты и СНГ принимаются онлайн:
  // не говорим «оплату подключаем», а даём покупателю оформить заказ и оплатить картой.
  const { robokassaFor } = await import("@/core/payments/payment");
  const rk = await robokassaFor(s.ctx).catch(() => ({ ready: false as const }));
  if (rk.ready) return null;
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
  // Страну покупателя запоминаем: «Не получится» на переводе Kaspi потом
  // получит честный ответ, а не «какой у вас банк» (Копилка 12.10, kramiliia).
  const now = new Date();
  let won = false;
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const at = Date.parse(String(cur.foreign_pay_at ?? ""));
    won = !(Number.isFinite(at) && now.getTime() - at < FOREIGN_PAY_REPLY_MS);
    if (!won)
      return cur.foreign_country === t.country ? null : { ...cur, foreign_country: t.country };
    return {
      ...cur,
      foreign_country: t.country,
      foreign_pay_at: now.toISOString(),
      forwarded_at: now.toISOString(),
    };
  }).catch((e) => {
    console.warn(`[triage:${s.ctx.tenant.id}] отметка оплаты из-за рубежа: ${String(e)}`);
    return null;
  });
  if (claimed) s.customer = claimed;
  // Уже отвечали сегодня (или отметку не поставить): вопрос продавцу молча.
  if (!claimed || !won) return "question";
  s.handoff = true;
  s.why = `оплата из страны без способа оплаты (${countryNameRu(t.country!)}) — ответили, вопрос продавцу`;
  await reply(s, s.m.foreignPayReply, { force: true });
  return "question";
}

/**
 * «Как можно получить?» после второго сообщения правила с «Купить», заказа
 * нет: позвать нажать кнопку и прислать её ещё раз — раз в HOW_TO_BUY_REPLY_MS
 * (условная отметка до отправки). boranbaeva__ainur (Копилка 12.10) после
 * карточки «Матрёшек» спросила, как получить, — тишина. Кнопки «Купить» за
 * сутки не было, есть заказ или продавец сейчас пишет сам — прежний путь
 * (null). Повтор в течение получаса — вопрос продавцу молча.
 */
async function howToBuyReply(s: Shop, who?: Sender): Promise<ShopOutcome | null> {
  const mode = s.customer.state.mode;
  // Шаг оплаты: «как оплатить» разбирает он сам (how_to_pay), здесь не мешаем (#109).
  if (mode && mode !== "idle") return null;
  if (s.customer.state.pending_order_id) return null;
  const { recentAwaitingPaymentOrder } = await import("@/core/orders/orders");
  if (await recentAwaitingPaymentOrder(s.ctx, s.customer)) return null;
  const { recentBuyDmButton } = await import("../automations.server");
  const button = await recentBuyDmButton(s.ctx, {
    username: who?.username ?? s.customer.username,
    senderId: who?.senderId,
  }).catch((e: unknown) => {
    console.warn(`[triage:${s.ctx.tenant.id}] кнопка «Купить»: ${String(e)}`);
    return null;
  });
  if (!button) return null;
  const { sellerWroteRecently } = await import("./country.server");
  if (await sellerWroteRecently(s)) return null;
  const now = Date.now();
  let prev = NaN;
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    prev = Date.parse(String(cur.how_to_buy_at ?? ""));
    if (Number.isFinite(prev) && now - prev < HOW_TO_BUY_REPLY_MS) return null;
    return { ...cur, how_to_buy_at: new Date(now).toISOString() };
  }).catch((e: unknown) => {
    console.warn(`[triage:${s.ctx.tenant.id}] отметка «как получить»: ${String(e)}`);
    return null;
  });
  // Две реплики подряд («Как получить?», «Как заказать?»): ответ только что
  // ушёл на первую — вторая без «Обращение создано». Позже — вопрос продавцу.
  if (!claimed) return now - prev < HOW_TO_BUY_BURST_MS ? "handled" : "question";
  s.customer = claimed;
  s.why = `спрашивает, как получить, — заказа нет, кнопка «${button.title}» выше`;
  await reply(s, s.m.howToBuyReply(button.title), {
    force: true,
    buttons: [{ type: "postback", title: button.title, payload: button.payload }],
  });
  return "handled";
}

/**
 * Вопрос, на который у бота нет ответа, но молчать нельзя: «несколько
 * материалов одним чеком?», название материала без правила и товара. Один
 * ответ «вопрос у продавца» в SELLER_QUESTION_REPLY_MS (условная отметка до
 * отправки, вместе с forwarded_at — «Передал продавцу» вторым сообщением не
 * уйдёт), вопрос продавцу обращением. Повторы — в то же обращение молча:
 * «Классный уголок» четыре раза подряд получает один ответ (Копилка 13.10).
 * Продавец сейчас пишет сам — бот не вмешивается.
 */
async function sellerQuestionReply(
  s: Shop,
  field: "several_items_at" | "product_request_at",
  text: string,
  buttons: DmButton[],
  why: string,
): Promise<ShopOutcome> {
  const { sellerWroteRecently } = await import("./country.server");
  if (await sellerWroteRecently(s)) return "question";
  const now = Date.now();
  const claimed = await claimStateSection(s.ctx, s.customer, "direct", (cur) => {
    const at = Date.parse(String(cur[field] ?? ""));
    if (Number.isFinite(at) && now - at < SELLER_QUESTION_REPLY_MS) return null;
    const iso = new Date(now).toISOString();
    return { ...cur, [field]: iso, forwarded_at: iso };
  }).catch((e: unknown) => {
    console.warn(`[triage:${s.ctx.tenant.id}] отметка ${field}: ${String(e)}`);
    return null;
  });
  if (!claimed) return "question";
  s.customer = claimed;
  s.handoff = true;
  s.why = why;
  await reply(s, text, { force: true, ...(buttons.length ? { buttons } : {}) });
  return "question";
}
