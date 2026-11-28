/**
 * Переезд одного магазина. Пока кнопки и книга не держат день без модели,
 * флаг не ставим. Откат — обратный флаг, строки назад руками не переносятся.
 * Запись флага этот модуль не делает: её включает отдельное «да».
 */

export function canCutOver(input: {
  buttonsGreen: boolean;
  bookGreen: boolean;
  aiOn: boolean;
  shadowGreen: boolean;
}): boolean {
  if (!input.buttonsGreen || !input.bookGreen) return false;
  if (input.aiOn && !input.shadowGreen) return false;
  return true;
}

/** Куда встал бы флаг, если переезд разрешён. Без разрешения — null, запись нечем. */
export function servedByAfter(action: "switch" | "rollback", allowed: boolean): "v4" | "v2" | null {
  if (!allowed) return null;
  return action === "rollback" ? "v2" : "v4";
}
