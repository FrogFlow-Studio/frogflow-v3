/**
 * ИИ после оплаты (Яков, 10.10): покупатель с оплаченным заказом пишет «отправьте
 * на почту», «не пришло», «где материалы». Что он имеет в виду, решает модель по
 * переписке и фактам заказа, а не список слов в коде; код только исполняет
 * один из трёх ответов и пишет тексты. Модель покупателю ничего не пишет сама.
 *
 * Здесь — чистые правила: промпт, инструмент, разбор ответа, тексты.
 * Вызов модели и факты заказа — decide.server.ts, исполнение — адаптер канала.
 */
import type { Locale } from "@/core/i18n/locale";

export const POSTPAY_MODEL = "claude-sonnet-5";
/** Sonnet 5, $ за миллион токенов. */
export const POSTPAY_PRICE = { in: 2, out: 10 };
/** «off» — выключено у клиента; по умолчанию включено. */
export const POSTPAY_ENABLED_KEY = "postpay_ai";
/** Потолок расхода в день, $; нет ключа — POSTPAY_DAILY_USD. */
export const POSTPAY_CAP_KEY = "postpay_ai_daily_usd";
export const postpaySpendKey = (date: string) => `postpay_ai_spend:${date}`;
export const POSTPAY_DAILY_USD = 0.5;
/** Заказ старше — уже не «после оплаты»: вопрос обычным путём. */
export const POSTPAY_WINDOW_DAYS = 14;
/** Повторных писем по одному заказу — не больше. */
export const POSTPAY_MAX_RESENDS = 3;
/** Два «отправьте ещё раз» за это время — одно письмо (двойное сообщение, повтор события). */
export const RESEND_BUCKET_MS = 10 * 60_000;
export const POSTPAY_TIMEOUT_MS = 15_000;
/** Длинное сообщение — это уже переписка, не «после оплаты». */
export const POSTPAY_MAX_TEXT = 600;

/** Статусы заказа, после которых покупатель спрашивает о материалах. */
export const POSTPAY_STATUSES = [
  "awaiting_confirmation",
  "paid",
  "delivering",
  "delivered",
] as const;
export type PostPayStatus = (typeof POSTPAY_STATUSES)[number];

export type PostPayFacts = {
  orderId: number;
  orderNo: number;
  status: PostPayStatus;
  items: string[];
  /** Почта в заказе. */
  email: string | null;
  /** Когда письмо с материалами последний раз ушло (ISO) и на какой адрес. */
  emailSentAt: string | null;
  /** Последнее письмо не ушло — ошибка почты. */
  emailFailed: boolean;
  resends: number;
};

export type ChatLine = { sender: string; text: string; at: string };

export type PostPayAction = "pass" | "status" | "resend" | "thanks";
export type PostPayDecision = { action: PostPayAction; email: string | null };

const STATUS_RU: Record<PostPayStatus, string> = {
  awaiting_confirmation: "чек получен, продавец ещё не подтвердил оплату",
  paid: "оплачен, материалы отправляются",
  delivering: "оплачен, материалы отправляются",
  delivered: "оплачен, материалы выданы в переписку",
};

export const POSTPAY_SYSTEM = `Ты помогаешь боту магазина в Instagram/WhatsApp понять последнее сообщение покупателя, у которого есть оплаченный (или ожидающий подтверждения) заказ цифровых материалов. Сам ты покупателю не пишешь: выбери действие инструментом decide.

Действия:
- status — покупатель спрашивает о своих материалах или письме: просит прислать на почту, спрашивает, ушло ли письмо, куда отправили, где файлы, когда придут. Бот ответит по фактам заказа: куда и когда ушло письмо, или попросит почту, если её нет.
- resend — покупатель прямо говорит, что письмо не пришло / не найти / ссылка не открывается, просит отправить ещё раз, или присылает почту (новую или исправленную) для материалов.
- thanks — покупатель только благодарит или прощается («спасибо», «благодарю», «получила, спасибо», 🌹, ❤️) и ни о чём не спрашивает и не просит. Бот ответит коротким «рада помочь» один раз, продавца не тревожит.
- pass — всё остальное: новый вопрос о товаре или цене, новая покупка, жалоба, благодарность вместе с вопросом или просьбой, приветствие, разговор с продавцом, непонятно. Сомневаешься — pass: тогда сообщение увидит продавец.

email — адрес почты, только если покупатель написал его в последнем сообщении; иначе пустая строка.`;

export const DECIDE_TOOL = {
  name: "decide",
  description: "Действие бота на последнее сообщение покупателя.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["pass", "status", "resend", "thanks"] },
      email: { type: "string" },
    },
    required: ["action", "email"],
  },
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const SENDER: Record<string, string> = { customer: "Покупатель", bot: "Бот", manager: "Продавец" };

export function postpayUserPrompt(p: {
  facts: PostPayFacts;
  lines: readonly ChatLine[];
  text: string;
  timezone: string;
  now: number;
}): string {
  const time = (iso: string) =>
    new Date(iso).toLocaleString("ru", {
      timeZone: p.timezone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  const f = p.facts;
  const mail = f.emailSentAt
    ? `письмо с материалами ушло ${time(f.emailSentAt)}`
    : f.email
      ? f.emailFailed
        ? "почта есть, письмо не ушло"
        : "почта есть, письма ещё не было"
      : "почты в заказе нет";
  const history = p.lines
    .map(
      (l) =>
        `[${time(l.at)}] ${SENDER[l.sender] ?? l.sender}: ${clip(l.text.replace(/\s+/g, " "), 200)}`,
    )
    .join("\n");
  return [
    `Заказ №${f.orderNo}: ${STATUS_RU[f.status]}; ${clip(f.items.join(", "), 200)}; ${mail}.`,
    `Сейчас ${time(new Date(p.now).toISOString())}.`,
    history ? `Переписка:\n${history}` : "",
    `Последнее сообщение покупателя: «${clip(p.text, POSTPAY_MAX_TEXT)}»`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Почта — нестрого, как в переписке магазина (shop-flow extractEmail). */
export function emailIn(text: string): string | null {
  const m = text.trim().match(/[^\s<>()[\],;:@"]+@[^\s<>()[\],;:@"]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Разбор decide. Почта принимается, только если она есть в сообщении
 * покупателя: модель не должна придумать адрес или взять его из истории.
 */
export function parseDecision(input: unknown, buyerText: string): PostPayDecision {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const action: PostPayAction =
    v.action === "status" || v.action === "resend" || v.action === "thanks" ? v.action : "pass";
  const written = emailIn(buyerText);
  const claimed = typeof v.email === "string" ? emailIn(v.email) : null;
  const email = written && (!claimed || claimed === written) ? written : null;
  return { action, email };
}

export function costUsd(usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  const i = Number(usage?.input_tokens) || 0;
  const o = Number(usage?.output_tokens) || 0;
  return Math.round(((i * POSTPAY_PRICE.in + o * POSTPAY_PRICE.out) / 1e6) * 1e6) / 1e6;
}

export function parseCap(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : POSTPAY_DAILY_USD;
}

export type Spend = { usd: number; calls: number };
export function parseSpend(raw: string | null | undefined): Spend {
  try {
    const v = JSON.parse(raw ?? "") as Partial<Spend>;
    return { usd: Number(v.usd) || 0, calls: Number(v.calls) || 0 };
  } catch {
    return { usd: 0, calls: 0 };
  }
}

/**
 * Что делает бот. Решение модели — «о чём просит»; что из этого возможно,
 * решают факты: без почты — спросить её, письмо уже ушло — сказать куда,
 * заказ ещё не выдан — материалы придут после подтверждения.
 */
export type PostPayStep =
  | { kind: "pass" }
  /** Благодарность после выдачи: один короткий ответ, продавцу не передаём. */
  | { kind: "thanks" }
  /** Благодарность, пока материалов ещё нет: не отвечаем и продавцу не передаём. */
  | { kind: "quiet" }
  | { kind: "ask_email" }
  | { kind: "told_sent"; email: string; at: string }
  | { kind: "send"; email: string; fresh: boolean }
  | { kind: "save_for_later"; email: string }
  | { kind: "pending"; email: string | null }
  | { kind: "limit"; email: string };

export function planStep(d: PostPayDecision, f: PostPayFacts): PostPayStep {
  if (d.action === "pass") return { kind: "pass" };
  if (d.action === "thanks")
    return f.status === "delivered" ? { kind: "thanks" } : { kind: "quiet" };
  const email = d.email ?? f.email;
  const newAddress = Boolean(d.email && d.email !== f.email?.trim().toLowerCase());
  if (f.status !== "delivered") {
    if (d.email && newAddress) return { kind: "save_for_later", email: d.email };
    return email ? { kind: "pending", email } : { kind: "ask_email" };
  }
  if (!email) return { kind: "ask_email" };
  // Письмо ушло, покупатель только спрашивает — сказать куда, не слать второе.
  if (d.action === "status" && !newAddress && f.emailSentAt)
    return { kind: "told_sent", email, at: f.emailSentAt };
  if (f.resends >= POSTPAY_MAX_RESENDS) return { kind: "limit", email };
  return { kind: "send", email, fresh: newAddress };
}

type Texts = {
  askEmail: (no: number) => string;
  toldSent: (email: string, when: string) => string;
  sent: (email: string) => string;
  saved: (email: string) => string;
  pending: (email: string | null) => string;
};

export const POSTPAY_TEXT: Record<Locale, Texts> = {
  ru: {
    askEmail: (no) =>
      `Напишите, пожалуйста, вашу почту — отправлю туда материалы по заказу №${no}.\n\n‼️ Почту пишите только текстом: фото и скриншоты с адресом не принимаются.`,
    toldSent: (email, when) =>
      `Материалы уже отправлены на ${email} (${when}). Если письма нет во «Входящих», загляните в «Спам» и «Промоакции». Нужно на другой адрес — напишите его.`,
    sent: (email) =>
      `Отправил материалы на ${email}. Письмо придёт в течение нескольких минут; если его нет, проверьте папку «Спам».`,
    saved: (email) =>
      `Записал почту ${email}. Материалы придут туда и сюда в переписку, как только оплата будет подтверждена.`,
    pending: (email) =>
      email
        ? `Оплату ещё подтверждают. Как только подтвердят, материалы придут сюда в переписку и на ${email}.`
        : "Оплату ещё подтверждают. Как только подтвердят, материалы придут сюда в переписку.",
  },
  kk: {
    askEmail: (no) =>
      `Поштаңызды жазыңызшы — №${no} тапсырыс материалдарын соған жіберемін.\n\n‼️ Поштаны тек мәтінмен жазыңыз: мекенжайы бар фото мен скриншот қабылданбайды.`,
    toldSent: (email, when) =>
      `Материалдар ${email} поштасына жіберілді (${when}). «Кіріс» қалтасында болмаса, «Спам» мен «Промоакциялар» қалтасын қараңыз. Басқа мекенжай керек болса — жазыңыз.`,
    sent: (email) =>
      `Материалдарды ${email} поштасына жібердім. Хат бірнеше минутта келеді; болмаса, «Спам» қалтасын тексеріңіз.`,
    saved: (email) =>
      `${email} поштасын жаздым. Төлем расталған соң материалдар сонда және осы хат алмасуға келеді.`,
    pending: (email) =>
      email
        ? `Төлем әлі расталуда. Расталған соң материалдар осы хат алмасуға және ${email} поштасына келеді.`
        : "Төлем әлі расталуда. Расталған соң материалдар осы хат алмасуға келеді.",
  },
  en: {
    askEmail: (no) =>
      `Please send your email address and I'll email the materials for order #${no}.\n\n‼️ Please type your email as text: photos and screenshots of the address are not accepted.`,
    toldSent: (email, when) =>
      `The materials were already sent to ${email} (${when}). If you can't find the email in your inbox, check Spam and Promotions. Need a different address? Just send it.`,
    sent: (email) =>
      `I've sent the materials to ${email}. The email should arrive within a few minutes; if not, check your Spam folder.`,
    saved: (email) =>
      `Saved ${email}. The materials will arrive there and here in the chat as soon as the payment is confirmed.`,
    pending: (email) =>
      email
        ? `The payment is still being confirmed. Once it is, the materials will arrive here in the chat and at ${email}.`
        : "The payment is still being confirmed. Once it is, the materials will arrive here in the chat.",
  },
  uz: {
    askEmail: (no) =>
      `Iltimos, pochtangizni yozing — №${no} buyurtma materiallarini o‘sha yerga yuboraman.\n\n‼️ Pochtani faqat matn bilan yozing: manzil yozilgan rasm va skrinshotlar qabul qilinmaydi.`,
    toldSent: (email, when) =>
      `Materiallar ${email} manziliga yuborilgan (${when}). «Kiruvchi»da bo‘lmasa, «Spam» va «Aksiyalar» papkasini tekshiring. Boshqa manzil kerak bo‘lsa — yozing.`,
    sent: (email) =>
      `Materiallarni ${email} manziliga yubordim. Xat bir necha daqiqada keladi; kelmasa, «Spam» papkasini tekshiring.`,
    saved: (email) =>
      `${email} pochtasini yozib oldim. To‘lov tasdiqlanishi bilan materiallar o‘sha yerga va shu yozishmaga keladi.`,
    pending: (email) =>
      email
        ? `To‘lov hali tasdiqlanmoqda. Tasdiqlangach, materiallar shu yozishmaga va ${email} manziliga keladi.`
        : "To‘lov hali tasdiqlanmoqda. Tasdiqlangach, materiallar shu yozishmaga keladi.",
  },
};

/** Ответ на почту в заказе, который уже выдан: письмо ушло сразу (не «после проверки оплаты»). */
export const emailSentNow = (locale: Locale, email: string) => POSTPAY_TEXT[locale].sent(email);
