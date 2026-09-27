export type Budget = { limit: number; windowMs: number };

/**
 * Бюджеты Mini App на одного покупателя в одном магазине. Оформление шлёт
 * сообщение от бота и пишет корзину — ему строже; «Мои заказы» подписывают
 * ссылки на файлы. В v1 бюджеты тоже были раздельными (tests/mini-app-rate-limit).
 */
export const MINI_APP_BUDGETS = {
  checkout: { limit: 6, windowMs: 60_000 },
  orders: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, Budget>;

/**
 * Скользящее окно в памяти процесса. Это мягкий лимит: у каждого экземпляра
 * функции свой счёт, после холодного старта он пуст. От пачки запросов
 * одного покупателя (двойной клик, зацикленный скрипт) этого хватает; таблицы
 * под лимиты в общей базе нет, а схему мы не меняем.
 */
export function rateLimiter(maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  return {
    /** true — запрос пропускаем и засчитываем; false — лимит исчерпан, отказ не засчитывается. */
    take(key: string, b: Budget, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - b.windowMs);
      if (recent.length >= b.limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      // Map помнит порядок вставки: переставляем ключ в конец, вытесняем самый давний.
      hits.delete(key);
      hits.set(key, recent);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
      return true;
    },
    size: () => hits.size,
  };
}

const miniApp = rateLimiter();

/** Пропустить ли запрос покупателя `tgId` магазина `botId` к части Mini App. */
export function takeMiniApp(
  botId: string,
  tgId: number,
  kind: keyof typeof MINI_APP_BUDGETS,
): boolean {
  return miniApp.take(`${botId}:${tgId}:${kind}`, MINI_APP_BUDGETS[kind]);
}

/**
 * Страница курса: каждый показ подписывает файлы открытых уроков, отметка
 * урока пишет в базу. Счёт — на покупку (магазин + позиция заказа), только
 * по верной ссылке: чужую покупку без её подписи не выесть.
 */
export const COURSE_BUDGET: Budget = { limit: 30, windowMs: 60_000 };
const course = rateLimiter();

export function takeCourse(botId: string, itemId: string): boolean {
  return course.take(`${botId}:${itemId}`, COURSE_BUDGET);
}
