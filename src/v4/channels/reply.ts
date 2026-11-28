import type { AdaptResult } from "./adapt";

/**
 * Что отправить покупателю после разбора. Одна отправка: обрыв и «неизвестно»
 * не повторяются. Кнопка карточки — offer:<код>, тот же путь, что и нажатие.
 */

export type OutboundButton = {
  label: string;
  /** callback_data, если это не кнопка Mini App. */
  data: string;
  /** Открыть магазин внутри Telegram. Тогда data в callback не уходит. */
  webAppUrl?: string;
};

/** Кнопка Telegram: окно магазина или нажатие в чате. */
export function telegramButton(b: OutboundButton): {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
} {
  if (b.webAppUrl) return { text: b.label, web_app: { url: b.webAppUrl } };
  return { text: b.label, callback_data: b.data };
}

export type Outbound = {
  chatId: string;
  text: string;
  buttons: OutboundButton[];
  /** Фото карточки. Без него сообщение текстовое. */
  photoUrl?: string;
  /** Править это сообщение. Канал отверг — отправитель шлёт новое. */
  editMessageId?: string;
};

const BUY: Record<string, string> = {
  ru: "Купить",
  kk: "Сатып алу",
  en: "Buy",
  uz: "Sotib olish",
};

const OPEN: Record<string, string> = {
  ru: "Открыть",
  kk: "Ашу",
  en: "Open",
  uz: "Ochish",
};

const TAKEN: Record<string, string> = {
  ru: "Заказ принят",
  kk: "Тапсырыс қабылданды",
  en: "Order accepted",
  uz: "Buyurtma qabul qilindi",
};

function money(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  return `${major} ${currency}`;
}

/** null — отвечать нечем (дубль, молчание, отказ). */
export function outboundOf(
  result: AdaptResult,
  chatId: string,
  lang = "ru",
  shopBase?: string,
): Outbound | null {
  const buy = BUY[lang] ?? "Купить";
  const taken = TAKEN[lang] ?? "Заказ принят";
  if (result.kind === "offer") {
    const title = result.title || buy;
    const open =
      shopBase && result.productId
        ? {
            label: OPEN[lang] ?? "Открыть",
            data: `offer:${result.offerId}`,
            webAppUrl: `${shopBase.replace(/\/$/, "")}/p/${result.productId}?offer=${result.offerId}`,
          }
        : null;
    return {
      chatId,
      text: `${title}\n${money(result.totalMinor, result.currency)}`,
      ...(result.photoUrl ? { photoUrl: result.photoUrl } : {}),
      buttons: [...(open ? [open] : []), { label: buy, data: `offer:${result.offerId}` }],
    };
  }
  if (result.kind === "buttons" || result.kind === "reply") {
    if (!result.text.trim()) return null;
    return { chatId, text: result.text, buttons: [] };
  }
  if (result.kind === "order" && !result.reused) return { chatId, text: taken, buttons: [] };
  return null;
}

/** Один вызов. Повтор при unknown сделал бы второе сообщение. */
export async function sendOnce(
  send: (message: Outbound) => Promise<"sent" | "failed" | "unknown">,
  message: Outbound | null,
): Promise<void> {
  if (!message) return;
  await send(message);
}
