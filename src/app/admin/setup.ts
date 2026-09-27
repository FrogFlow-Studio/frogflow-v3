/**
 * Мастер первого запуска на «Обзоре»: шаги по порядку и тестовый заказ на
 * себя. Чистые функции — страница рисует, тесты проверяют.
 */
export const SETUP_STEPS = [
  "telegram",
  "products",
  "payment",
  "notifications",
  "legal",
  "firstOrder",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** Самый ранний несделанный шаг — его мастер подсвечивает; всё сделано — null. */
export function nextSetupStep(done: Record<SetupStep, boolean>): SetupStep | null {
  return SETUP_STEPS.find((s) => !done[s]) ?? null;
}

/**
 * Ссылка «Тестовый заказ на себя»: бот продавца сразу на карточке его
 * товара (тот же `/start p_<id>`, что у ссылок на товар). Продавец проходит
 * путь покупателя целиком: корзина, оформление, чек, подтверждение, выдача.
 * Нет бота или включённого товара — что именно сделать сначала.
 */
export function testOrderLink(
  botUsername: string | null,
  productId: string | null,
): { url: string } | { missing: "telegram" | "products" } {
  const bot = botUsername?.replace(/^@/, "") ?? "";
  if (!/^[A-Za-z0-9_]{3,64}$/.test(bot)) return { missing: "telegram" };
  if (!productId) return { missing: "products" };
  return { url: `https://t.me/${bot}?start=p_${productId}` };
}
