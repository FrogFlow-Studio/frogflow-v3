/**
 * Короткий адрес магазина (/s/<адрес>, bots.settings.slug). Одно правило на
 * витрину, регистрацию, панель и API оператора: регистрация отдаёт логин
 * владельца с «_» и «.» в адрес, и оператор должен суметь его сохранить.
 */
export const SHOP_SLUG_RE = /^[a-z0-9][a-z0-9_.-]{1,39}$/;

/** То же для атрибута pattern у input (браузер добавляет ^…$ сам). */
export const SHOP_SLUG_PATTERN = "[a-z0-9][a-z0-9_.\\-]{1,39}";

export function isShopSlug(s: string): boolean {
  return SHOP_SLUG_RE.test(s);
}
