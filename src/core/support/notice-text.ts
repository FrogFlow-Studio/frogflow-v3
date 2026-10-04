import type { Locale } from "@/core/i18n/locale";

/**
 * Тексты уведомлений о сообщениях поддержки. Продавцу — на языке его админки
 * (в Telegram, обычным текстом); оператору — по-русски (HTML для Telegram).
 */
const PREVIEW_MAX = 300;

/** Начало сообщения для уведомления: пробелы схлопнуты, длинное обрезано многоточием. */
export function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

const SELLER: Record<Locale, (text: string, url: string) => string> = {
  ru: (t, u) => `💬 Поддержка FrogFlow ответила:\n\n${t}\n\nОтветить: ${u}`,
  kk: (t, u) => `💬 FrogFlow қолдауы жауап берді:\n\n${t}\n\nЖауап беру: ${u}`,
  en: (t, u) => `💬 FrogFlow support replied:\n\n${t}\n\nReply: ${u}`,
  uz: (t, u) => `💬 FrogFlow yordami javob berdi:\n\n${t}\n\nJavob berish: ${u}`,
};

export function sellerReplyText(locale: Locale, body: string, url: string): string {
  return SELLER[locale](preview(body), url);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Оператору: кто написал и начало сообщения, ссылка на переписку. */
export function operatorAlertHtml(shop: string, body: string, url: string): string {
  return `💬 <b>Поддержка</b>: «${esc(shop)}» пишет\n\n${esc(preview(body))}\n\n${esc(url)}`;
}
