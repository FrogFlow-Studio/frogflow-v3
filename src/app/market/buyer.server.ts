import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { env } from "@/config/env";
import {
  MARKET_COOKIE,
  MARKET_SESSION_SEC,
  identityFromUserKey,
  signMarketSession,
  verifyMarketSession,
} from "@/core/marketplace/buyer-session";
import type { VerifiedBy } from "@/core/marketplace/buyers.server";
import type { TenantContext } from "@/core/tenant/resolve.server";

const COOKIE = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };

/** id человека на площадке из cookie или null. */
export function marketBuyerId(): string | null {
  return verifyMarketSession(env().SESSION_SECRET, getCookie(MARKET_COOKIE));
}

export function endMarketSession(): void {
  deleteCookie(MARKET_COOKIE, COOKIE);
}

/**
 * После подтверждённого входа в магазин (виджет Telegram или код из бота) связываем профиль
 * с человеком на площадке и выдаём cookie. Вход в магазин от этого не зависит: любой сбой
 * здесь (таблиц нет, база не ответила) только оставляет аккаунт площадки невключённым.
 */
export async function rememberMarketBuyer(
  ctx: TenantContext,
  telegramId: number,
  via: VerifiedBy,
): Promise<void> {
  try {
    const { getCustomerByTelegramId } = await import("@/core/customers/customers");
    const customer = await getCustomerByTelegramId(ctx, telegramId);
    const identity = customer ? identityFromUserKey(customer.userKey, via) : null;
    if (!customer || !identity) return;
    const { linkBuyerToShop } = await import("@/core/marketplace/buyers.server");
    const r = await linkBuyerToShop(ctx, identity, customer.userKey);
    if (r.status !== "linked" && r.status !== "already") return;
    setCookie(MARKET_COOKIE, signMarketSession(env().SESSION_SECRET, r.buyerId), {
      ...COOKIE,
      maxAge: MARKET_SESSION_SEC,
    });
  } catch {
    // вход в магазин уже выдан; аккаунт площадки подключится при следующем входе
  }
}
