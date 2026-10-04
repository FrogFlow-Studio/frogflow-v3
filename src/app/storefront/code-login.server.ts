import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { validNonce } from "@/core/storefront/code-login";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Метка браузера для входа по коду (В5): случайные 128 бит в HttpOnly-cookie
 * этого магазина на 15 минут. Сама по себе ничего не открывает — нужен ещё код
 * из чата с ботом.
 */
export const LOGIN_NONCE_SEC = 15 * 60;
const COOKIE = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

export function loginNonceCookie(botId: string): string {
  return `ff_cl_${botId.replace(/[^0-9a-f]/gi, "").toLowerCase()}`;
}

export function setLoginNonce(ctx: TenantContext, nonce: string): void {
  setCookie(loginNonceCookie(ctx.tenant.id), nonce, { ...COOKIE, maxAge: LOGIN_NONCE_SEC });
}

export function readLoginNonce(ctx: TenantContext): string | null {
  const v = getCookie(loginNonceCookie(ctx.tenant.id));
  return validNonce(v) ? v : null;
}

export function clearLoginNonce(ctx: TenantContext): void {
  deleteCookie(loginNonceCookie(ctx.tenant.id), COOKIE);
}
