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

/**
 * Служебные адреса: их нельзя занять регистрацией или в панели оператора.
 * Это части адресов платформы, имена самой FrogFlow и платёжных систем,
 * на которые покупателя проще всего обмануть («/s/support», «/s/kaspi»).
 * Сравнение — без точек, дефисов и «_»: «ad-min» и «a.d.m.i.n» тоже нельзя.
 */
const RESERVED = new Set([
  "admin",
  "administrator",
  "operator",
  "root",
  "system",
  "api",
  "app",
  "www",
  "web",
  "mail",
  "email",
  "smtp",
  "ftp",
  "cdn",
  "static",
  "assets",
  "public",
  "s",
  "img",
  "files",
  "uploads",
  "signup",
  "register",
  "login",
  "logout",
  "signin",
  "auth",
  "oauth",
  "account",
  "accounts",
  "profile",
  "settings",
  "dashboard",
  "panel",
  "console",
  "support",
  "help",
  "helpdesk",
  "service",
  "official",
  "security",
  "status",
  "health",
  "docs",
  "blog",
  "news",
  "legal",
  "terms",
  "privacy",
  "oferta",
  "offer",
  "billing",
  "invoice",
  "pay",
  "payment",
  "payments",
  "checkout",
  "cart",
  "shop",
  "store",
  "market",
  "miniapp",
  "webhook",
  "webhooks",
  "cron",
  "telegram",
  "instagram",
  "whatsapp",
  "zernio",
  "kaspi",
  "kaspipay",
  "robokassa",
  "halyk",
  "null",
  "undefined",
]);

export function isReservedSlug(s: string | null | undefined): boolean {
  const flat = (s ?? "").trim().toLowerCase().replace(/[._-]/g, "");
  if (!flat) return false;
  return RESERVED.has(flat) || flat.includes("frogflow");
}
