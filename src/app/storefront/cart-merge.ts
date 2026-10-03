import type { CartLine } from "./cart";

/**
 * Несколько позиций в корзину витрины за раз («Повторить заказ»). Смешанная
 * корзина не поддерживается (у файлов и физических товаров разное оформление),
 * как и в `add`: позиции другого вида отдаём в `mixed`, корзину не трогаем.
 * Уже лежащая позиция получает сегодняшние название и цену, количество
 * физического складывается (до 99), цифровое остаётся одним.
 */
export function mergeCartLines(
  current: readonly CartLine[],
  incoming: readonly CartLine[],
): { lines: CartLine[]; added: CartLine[]; mixed: CartLine[] } {
  const lines = current.slice();
  const added: CartLine[] = [];
  const mixed: CartLine[] = [];
  for (const line of incoming) {
    if (lines.some((l) => l.kind !== line.kind)) {
      mixed.push(line);
      continue;
    }
    const i = lines.findIndex(
      (l) => l.productId === line.productId && l.variantId === line.variantId,
    );
    const qty = line.kind === "digital" ? 1 : Math.min(99, (i >= 0 ? lines[i]!.qty : 0) + line.qty);
    if (i >= 0) lines[i] = { ...line, qty };
    else lines.push({ ...line, qty });
    added.push(line);
  }
  return { lines, added, mixed };
}
