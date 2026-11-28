/**
 * ИИ — отдельная надстройка, не магазин на кнопках. Каждый шаг выключен,
 * пока его явно не включили. Покупка и без флажка, и с ним остаётся кнопкой
 * «Купить»: модель оплату текстом не проводит. Живой экзамен, тень и ночной
 * разбор этот файл не запускает.
 */

export const AI_GATES = [
  { id: "live_exam", buyerHears: false },
  { id: "shadow", buyerHears: false },
  { id: "one_shop", buyerHears: true },
  { id: "receipt_hint", buyerHears: false },
  { id: "seller_assistant", buyerHears: false },
  { id: "night_review", buyerHears: false },
] as const;

export type AiGateId = (typeof AI_GATES)[number]["id"];

export type AiFlags = {
  buyer?: boolean;
  receipt_hint?: boolean;
  seller_assistant?: boolean;
  night_review?: boolean;
};

/** Покупатель слышит модель только на шаге «один магазин» и только с флажком. */
export function buyerHearsModel(flags: AiFlags | null | undefined): boolean {
  return flags?.buyer === true;
}

export function gateOpen(id: AiGateId, flags: AiFlags | null | undefined): boolean {
  if (id === "one_shop") return flags?.buyer === true;
  if (id === "receipt_hint") return flags?.receipt_hint === true;
  if (id === "seller_assistant") return flags?.seller_assistant === true;
  if (id === "night_review") return flags?.night_review === true;
  return false;
}

/** Подсказка по чеку не пишет в книгу. Без своего флажка её нет. */
export function receiptHint(flags: AiFlags | null | undefined, note: string): string | null {
  if (!gateOpen("receipt_hint", flags)) return null;
  const text = note.trim();
  return text ? text : null;
}
