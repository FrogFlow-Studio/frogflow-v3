import type { Locale } from "@/core/i18n/locale";
import { pickReceiptAttachment } from "./shop-flow";

/**
 * Сообщения без текста в Direct и WhatsApp (Б6): голосовое, стикер, видео и
 * фото вне оплаты. Раньше бот молчал, и покупатель не понимал, дошло ли.
 * Тексты на языке покупателя; продавцу — на языке панели.
 */
export type NonTextKind = "voice" | "sticker" | "video" | "photo";

/** Один ответ на «не текст» не чаще, чем раз в это время. */
export const NON_TEXT_WINDOW_MS = 10 * 60_000;

type Att = { url?: string; type?: string; mimeType?: string };

export function nonTextKind(attachments: Att[] | null | undefined): NonTextKind | null {
  const list = attachments ?? [];
  if (list.length === 0) return null;
  const type = (a: Att) => a.type?.trim().toLowerCase() ?? "";
  const mime = (a: Att) => a.mimeType?.trim().toLowerCase() ?? "";
  if (list.some((a) => ["audio", "voice"].includes(type(a)) || mime(a).startsWith("audio/")))
    return "voice";
  if (list.some((a) => type(a) === "sticker")) return "sticker";
  if (list.some((a) => type(a) === "video" || mime(a).startsWith("video/"))) return "video";
  // Картинка или файл со ссылкой — то, что могло бы быть чеком.
  return pickReceiptAttachment(list) ? "photo" : null;
}

export const TEXT_ONLY: Record<Locale, string> = {
  ru: "Я понимаю только текст. Напишите код товара или нажмите «Каталог».",
  kk: "Мен тек мәтінді түсінемін. Тауар кодын жазыңыз немесе «Каталог» түймесін басыңыз.",
  en: "I only understand text. Write a product code or tap “Catalog”.",
  uz: "Men faqat matnni tushunaman. Mahsulot kodini yozing yoki «Katalog» tugmasini bosing.",
};

export const PHOTO_FORWARDED: Record<Locale, string> = {
  ru: "Передал ваше фото продавцу. Если нужен каталог — напишите «каталог».",
  kk: "Фотоңызды сатушыға жібердім. Каталог керек болса — «каталог» деп жазыңыз.",
  en: "I passed your photo to the seller. For the catalog, write “catalog”.",
  uz: "Rasmingizni sotuvchiga uzatdim. Katalog kerak bo‘lsa — «katalog» deb yozing.",
};

export const SELLER_PHOTO: Record<Locale, (who: string, channel: string) => string> = {
  ru: (who, ch) =>
    `📷 ${who} (${ch}) прислал(а) фото — не чек: заказа, который ждёт оплаты, нет. Ответьте в приложении.`,
  kk: (who, ch) =>
    `📷 ${who} (${ch}) фото жіберді — чек емес: төлем күтіп тұрған тапсырыс жоқ. Қолданбада жауап беріңіз.`,
  en: (who, ch) =>
    `📷 ${who} (${ch}) sent a photo — not a receipt: no order is waiting for payment. Reply in the app.`,
  uz: (who, ch) =>
    `📷 ${who} (${ch}) rasm yubordi — chek emas: to‘lov kutayotgan buyurtma yo‘q. Ilovada javob bering.`,
};

/**
 * Консультант ИИ: сообщение — только стикеры или гифки-реакции (giphy из
 * стикеров Instagram). Это смайлик, а не вопрос: v1 BOVI на него молчал,
 * звать менеджера или модель незачем.
 */
export function isStickerOnly(attachments: Att[] | null | undefined): boolean {
  const list = attachments ?? [];
  return (
    list.length > 0 &&
    list.every((a) => a.type?.trim().toLowerCase() === "sticker" || /giphy\.com/i.test(a.url ?? ""))
  );
}

/** Консультант ИИ: голосовое не слушает — просит написать (v1 BOVI). */
export const VOICE_WRITE_TEXT: Record<Locale, string> = {
  ru: "Голосовые сообщения я не слушаю — напишите, пожалуйста, вопрос текстом.",
  kk: "Дауыстық хабарламаларды тыңдай алмаймын — сұрағыңызды мәтінмен жазыңызшы.",
  en: "I can't listen to voice messages — please type your question.",
  uz: "Ovozli xabarlarni tinglay olmayman — iltimos, savolingizni matn bilan yozing.",
};
