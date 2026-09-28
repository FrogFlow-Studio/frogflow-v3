/**
 * Удаление магазина владельцем с холдом 30 дней — правила без базы, чтобы
 * их проверяли тесты. Запрос: магазин встаёт на паузу (бот отвечает
 * сообщением паузы, витрина закрыта, Instagram/WhatsApp молчат), владелец
 * входит в админку и может восстановить. По истечении холда крон
 * ретеншна архивирует магазин и удаляет файлы из хранилища; строки заказов
 * остаются для учёта, как и у архивных клиентов оператора.
 */
export const DELETION_HOLD_DAYS = 30;

export function deletionDueAt(requestedAt: string): Date {
  return new Date(Date.parse(requestedAt) + DELETION_HOLD_DAYS * 86400_000);
}

/** Холд истёк — пора архивировать. */
export function deletionDue(d: { requested_at: string } | undefined, now = Date.now()): boolean {
  return Boolean(d) && deletionDueAt(d!.requested_at).getTime() <= now;
}

/** Сколько полных дней осталось до удаления (0 — сегодня). */
export function deletionDaysLeft(requestedAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((deletionDueAt(requestedAt).getTime() - now) / 86400_000));
}

/** Подтверждение — название магазина, введённое владельцем, без учёта регистра и пробелов по краям. */
export function deletionConfirmed(typed: string, shopName: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) !== "" && norm(typed) === norm(shopName);
}
