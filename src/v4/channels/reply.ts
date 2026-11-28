import type { AdaptResult } from "./adapt";

/**
 * Что отправить покупателю после разбора. Одна отправка: обрыв и «неизвестно»
 * не повторяются. Кнопка карточки — offer:<код>, тот же путь, что и нажатие.
 */

export type OutboundButton = { label: string; data: string };

export type Outbound = {
  chatId: string;
  text: string;
  buttons: OutboundButton[];
};

const BUY: Record<string, string> = {
  ru: "Купить",
  kk: "Сатып алу",
  en: "Buy",
  uz: "Sotib olish",
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
export function outboundOf(result: AdaptResult, chatId: string, lang = "ru"): Outbound | null {
  const buy = BUY[lang] ?? "Купить";
  const taken = TAKEN[lang] ?? "Заказ принят";
  if (result.kind === "offer") {
    const title = result.title || buy;
    return {
      chatId,
      text: `${title}\n${money(result.totalMinor, result.currency)}`,
      buttons: [{ label: buy, data: `offer:${result.offerId}` }],
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
