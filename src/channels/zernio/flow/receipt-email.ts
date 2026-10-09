/** Чек об оплате и почта покупателя. */

/** Вложения, которые чеком не бывают: голосовое, видео, пересланный пост, эхо шаблона, сторис. */
const NOT_RECEIPT_TYPES = new Set([
  "audio",
  "voice",
  "video",
  "share",
  "ephemeral",
  "template",
  "sticker",
  "story",
  "story_mention",
  "story_reply",
  "ig_story",
  "reel",
  "ig_reel",
  "location",
  "contacts",
  "fallback",
]);

const RECEIPT_TYPES = new Set(["image", "photo", "file", "document"]);

/**
 * Какое вложение считать чеком. Сначала явная картинка или файл (по типу или
 * mime), потом — любое вложение незнакомого типа со ссылкой: Zernio уже
 * переименовывал типы, и новое имя не должно терять чек. Голосовое, видео,
 * пересланный пост и эхо шаблона чеком не считаются. Без типа — старые
 * события, всегда фото.
 */
export function pickReceiptAttachment(
  attachments: Array<{ url?: string; type?: string; mimeType?: string }> | null | undefined,
): string | null {
  const withUrl = (attachments ?? []).filter((a) => a.url);
  const typeOf = (a: { type?: string }) => a.type?.trim().toLowerCase() ?? "";
  const mimeOf = (a: { mimeType?: string }) => a.mimeType?.trim().toLowerCase() ?? "";
  const explicit = withUrl.find((a) => {
    const mime = mimeOf(a);
    return (
      !typeOf(a) ||
      RECEIPT_TYPES.has(typeOf(a)) ||
      mime.startsWith("image/") ||
      mime === "application/pdf"
    );
  });
  if (explicit) return explicit.url!;
  const unknown = withUrl.find((a) => {
    const mime = mimeOf(a);
    return (
      !NOT_RECEIPT_TYPES.has(typeOf(a)) && !mime.startsWith("audio/") && !mime.startsWith("video/")
    );
  });
  return unknown?.url ?? null;
}

/**
 * Нужен ли шаг «ваша почта» перед оформлением (перенос из v1). С 09.10 — нет:
 * цифровой заказ выдаётся в переписку, а вопрос о почте терял покупателей.
 * Сигнатура оставлена, чтобы шаг можно было вернуть настройкой.
 */
export function emailStep(_p: {
  platform: string;
  physical: boolean;
  knownEmail: string | null | undefined;
  skipped: boolean;
  mailReady: boolean;
}): "required" | "optional" | null {
  // Файлы приходят ссылками и кнопкой «Скачать» прямо в переписку (deliver.ts),
  // почта — лишь дополнительно. Вопрос о ней перед оплатой сбивал покупателей:
  // отвечали телефоном, «можно на ватсап», уходили в каталог (Копилка русоведа,
  // 09.10), — поэтому в переписке его больше не задаём.
  return null;
}

/** Почта — нестрого: поймать опечатку, а не отсеять экзотику по RFC. */
export function extractEmail(text: string): string | null {
  const match = text.trim().match(/[^\s<>()[\],;:@"]+@[^\s<>()[\],;:@"]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}
