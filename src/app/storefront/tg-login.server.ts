import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { env } from "@/config/env";
import {
  BUYER_SESSION_SEC,
  botTokenStamp,
  buyerCookieName,
  signBuyerSession,
  verifyBuyerSession,
} from "@/core/storefront/tg-login";
import { webCheckoutSettings } from "@/core/storefront/web-order";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Cookie входа покупателя на витрину. Своя у каждого магазина, HttpOnly,
 * Secure, SameSite=Lax; подпись серверным ключом привязана к магазину и к
 * токену его бота.
 */
const COOKIE = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

/** Токен бота магазина или null: бота нет или токен не расшифровался. */
function botToken(ctx: TenantContext): string | null {
  if (!ctx.tenant.telegramTokenEnc) return null;
  try {
    return ctx.secrets.telegramToken();
  } catch {
    return null;
  }
}

/** Вход через Telegram на витрине этого магазина включён и возможен. */
export async function tgLoginAvailable(ctx: TenantContext): Promise<boolean> {
  if (!botToken(ctx) || !ctx.tenant.settings.telegram?.username) return false;
  const s = await webCheckoutSettings(ctx);
  return s.enabled && s.tgLogin;
}

/** id вошедшего покупателя в Telegram или null. Продавец выключил вход — входы не действуют. */
export async function buyerTelegramId(ctx: TenantContext): Promise<number | null> {
  const token = botToken(ctx);
  if (!token) return null;
  const value = getCookie(buyerCookieName(ctx.tenant.id));
  if (!value) return null;
  if (!(await tgLoginAvailable(ctx))) return null;
  return verifyBuyerSession(env().SESSION_SECRET, ctx.tenant.id, botTokenStamp(token), value);
}

export function startBuyerSession(ctx: TenantContext, telegramId: number): void {
  const token = botToken(ctx);
  if (!token) throw new Error("no bot token");
  setCookie(
    buyerCookieName(ctx.tenant.id),
    signBuyerSession(env().SESSION_SECRET, ctx.tenant.id, botTokenStamp(token), telegramId),
    { ...COOKIE, maxAge: BUYER_SESSION_SEC },
  );
}

export function endBuyerSession(ctx: TenantContext): void {
  deleteCookie(buyerCookieName(ctx.tenant.id), COOKIE);
}
