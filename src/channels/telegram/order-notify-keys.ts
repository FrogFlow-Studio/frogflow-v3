import type { Locale } from "@/core/i18n/locale";
import { handoverAllowed } from "@/core/orders/handover";

/**
 * Кнопки под уведомлением продавцу о заказе. Физический заказ ведётся
 * по статусам accepted → in_production → ready → delivered (PHYSICAL_NEXT, как
 * в админке): «В работу», «Собран», затем «Отправлен» или «Выдан» — оба
 * закрывают заказ статусом «выдан», различается только сообщение покупателю
 * и запись в истории (step). Отдельного статуса «отправлен» в базе нет, схема
 * не меняется.
 */
export type OrderStep = "work" | "ready" | "shipped" | "done";

/** Из какого статуса шаг допустим и куда ведёт — условная запись берёт `from`. */
export const ORDER_STEPS: Record<OrderStep, { from: string; to: string }> = {
  work: { from: "accepted", to: "in_production" },
  ready: { from: "in_production", to: "ready" },
  shipped: { from: "ready", to: "delivered" },
  done: { from: "ready", to: "delivered" },
};

export function isOrderStep(v: string): v is OrderStep {
  return Object.prototype.hasOwnProperty.call(ORDER_STEPS, v);
}

const LABELS: Record<Locale, Record<OrderStep | "write" | "track", string>> = {
  ru: {
    work: "🧑‍🍳 В работу",
    ready: "📦 Собран",
    shipped: "🚚 Отправлен",
    done: "✅ Выдан",
    track: "📮 Отправлен + трек",
    write: "✉️ Написать покупателю",
  },
  kk: {
    work: "🧑‍🍳 Жұмысқа",
    ready: "📦 Жиналды",
    shipped: "🚚 Жөнелтілді",
    done: "✅ Берілді",
    track: "📮 Жөнелтілді + трек",
    write: "✉️ Сатып алушыға жазу",
  },
  en: {
    work: "🧑‍🍳 Start work",
    ready: "📦 Packed",
    shipped: "🚚 Shipped",
    done: "✅ Handed over",
    track: "📮 Shipped + tracking",
    write: "✉️ Message the buyer",
  },
  uz: {
    work: "🧑‍🍳 Ishga",
    ready: "📦 Yigʻildi",
    shipped: "🚚 Joʻnatildi",
    done: "✅ Topshirildi",
    track: "📮 Joʻnatildi + trek",
    write: "✉️ Xaridorga yozish",
  },
};

type Key = { text: string; callback_data: string };

/** Кнопка «Написать покупателю» — одна на все статусы, пока уведомление живо. */
export function writeBuyerButton(orderId: number, locale: Locale): Key {
  return { text: LABELS[locale].write, callback_data: `owr:${orderId}` };
}

/**
 * Кнопки по текущему статусу физического заказа. Пустой список — шагов нет
 * (выдан, закрыт): уведомление тогда снимается.
 */
export function orderStepKeyboard(
  order: { id: number; status: string; fulfillment_type?: string | null },
  locale: Locale,
): Key[][] {
  const L = LABELS[locale];
  const steps = (Object.keys(ORDER_STEPS) as OrderStep[]).filter(
    (s) =>
      ORDER_STEPS[s].from === order.status &&
      (s === "shipped" || s === "done" ? handoverAllowed(order.fulfillment_type, s) : true),
  );
  if (!steps.length) return [];
  return [
    steps.map((s) => ({ text: L[s], callback_data: `ost:${order.id}:${s}` })),
    // «Отправлен + трек» — только когда заказ собран: следующий шаг — отправка.
    ...(order.status === "ready" ? [[{ text: L.track, callback_data: `otr:${order.id}` }]] : []),
    [writeBuyerButton(order.id, locale)],
  ];
}

/** Метка в тексте сообщения «ответьте свайпом» — по ней ответ находит заказ. */
export function orderWriteRefLine(orderId: number): string {
  return `[#o:${orderId}]`;
}

export function orderWriteRefOf(text: string | null | undefined): number | null {
  const m = /\[#o:(\d{1,12})\]/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

/** Метка «ответьте номером» — по ней ответ свайпом находит заказ. */
export function orderTrackRefLine(orderId: number): string {
  return `[#t:${orderId}]`;
}

export function orderTrackRefOf(text: string | null | undefined): number | null {
  const m = /\[#t:(\d{1,12})\]/.exec(text ?? "");
  return m ? Number(m[1]) : null;
}
