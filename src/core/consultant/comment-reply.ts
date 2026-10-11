import type { Locale } from "@/core/i18n/locale";

/**
 * Ответ консультанта на комментарий в Instagram (BOVI, решение Якова
 * 11.10.2026). На комментарий Instagram разрешает одно личное сообщение
 * (private reply); у BOVI правил на комментарии нет, и «Куб», «Цена на 2х и
 * семейные?» оставались без ответа. Консультант читает комментарий и подпись
 * публикации, находит товар в прайсе и отвечает ценой в это единственное
 * сообщение. Уверенности нет (нет цены, передача менеджеру, сбой) —
 * дежурное приглашение написать в Direct. Под комментарием публично ничего
 * не пишем. Понимание — у модели, код только проверяет итог.
 */
export const COMMENT_REPLY_KEY = "consultant_comment_reply";

/** Клиенты, у которых без выбора продавца ответ включён: BOVI. */
export const COMMENT_REPLY_DEFAULT_ON: readonly string[] = ["bb3ffba7-edf0-4cce-8742-ff10c9495c44"];

/** "true"/"false" — выбор продавца; без значения — по умолчанию клиента. */
export function commentReplyOn(raw: string | null | undefined, botId: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return COMMENT_REPLY_DEFAULT_ON.includes(botId);
}

/** Дежурное приглашение, когда цену не нашли уверенно. */
export const COMMENT_NEUTRAL: Record<Locale, string> = {
  ru: "Здравствуйте! Подскажу по цене, напишите мне здесь, что интересует.",
  kk: "Сәлеметсіз бе! Бағасын айтып беремін, осында не қызықтыратынын жазыңыз.",
  en: "Hello! I'll help with the price, just write here what you're interested in.",
  uz: "Assalomu alaykum! Narxini aytib beraman, nima qiziqtirayotganini shu yerga yozing.",
};

/** Текст длиннее Instagram отклоняет (#35/#38/#53) — такой ответ не шлём, а не обрезаем. */
export const COMMENT_REPLY_MAX_CHARS = 1000;

/**
 * Пометка для модели перед комментарием. Покупатель её не видит; в историю
 * диалога идёт сам комментарий.
 */
export function commentNote(): string {
  return "[Это комментарий под публикацией в Instagram, а не сообщение в Direct. Ваш ответ уйдёт покупателю одним личным сообщением, второго не будет, пока он сам не напишет. Поэтому сразу назовите товар и цену из прайса (2–3 варианта размеров, если размер не назван) и в конце пригласите написать сюда, если нужно подобрать. Фото не отправляйте — в этом сообщении их не будет. Если по комментарию и подписи товар уверенно не найти, цену не называйте и хиты магазина не предлагайте.]";
}

/** В ответе есть сумма в тенге или рублях — значит, консультант нашёл товар и цену. */
const PRICE_RE = /\d[\d\s .,]*\s?(₸|тг(?![а-яё])|тенге|₽|руб)/i;
const PHOTO_RE = /фото|сурет|photo|rasm/i;

export type CommentAnswerInput = {
  reply: string;
  handoff: boolean;
  /** Модель хотела приложить фото товара — в private reply их не будет. */
  attachments: number;
  /** Ответ не уйдёт по прайсу: сверка цен не прошла или модель не ответила. */
  failed?: boolean;
};

export type CommentAnswer =
  { kind: "price"; text: string } | { kind: "neutral"; text: string; why: string };

/**
 * Что уйдёт покупателю: ответ консультанта, только если в нём есть цена и он
 * самодостаточен; иначе — дежурное приглашение на языке комментария.
 */
export function pickCommentAnswer(a: CommentAnswerInput | null, locale: Locale): CommentAnswer {
  const neutral = (why: string): CommentAnswer => ({
    kind: "neutral",
    text: COMMENT_NEUTRAL[locale],
    why,
  });
  if (!a || a.failed) return neutral("консультант не ответил");
  const text = a.reply.trim();
  if (a.handoff) return neutral("консультант передал бы менеджеру");
  if (!text) return neutral("пустой ответ");
  if (!PRICE_RE.test(text)) return neutral("в ответе нет цены");
  if (text.length > COMMENT_REPLY_MAX_CHARS) return neutral("ответ длиннее 1000 знаков");
  if (a.attachments > 0 && PHOTO_RE.test(text)) return neutral("ответ ссылается на фото");
  return { kind: "price", text };
}
