import type { TenantContext } from "@/core/tenant/resolve.server";
import { createHash } from "node:crypto";
import { takeShared, type Budget } from "./rate-limit";

/**
 * Защита анонимного оформления на витрине, как у регистрации (#71, #121):
 * задача для браузера (app/signup/challenge.ts, назначение «checkout») и
 * бронь её решения — строка app_settings `checkout_challenge:<отпечаток>`.
 * Пара (bot_id, key) уникальна, поэтому одно решение не оформит два заказа,
 * даже если две отправки придут одновременно. Брони старше суток чистит
 * ночная уборка (pruneCheckoutChallenges).
 */
export const CHECKOUT_CHALLENGE_PREFIX = "checkout_challenge:";

export async function claimCheckoutChallenge(
  ctx: TenantContext,
  nonce: string,
  now = new Date(),
): Promise<"ok" | "used" | "failed"> {
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `${CHECKOUT_CHALLENGE_PREFIX}${nonce}`,
    value: now.toISOString(),
    updated_at: now.toISOString(),
  });
  if (!error) return "ok";
  return error.code === "23505" ? "used" : "failed";
}

/**
 * Лимиты частоты — общие для всех экземпляров функции (takeShared: память и
 * счётчик в app_settings). Оформление — с одного адреса и на одну почту;
 * оформление с кодом скидки — с одного адреса за час; страница заказа,
 * загрузка чека и оплата картой — на заказ. Адрес и почта
 * в ключ счётчика идут отпечатком, а не открытым текстом.
 */
export const WEB_BUDGETS = {
  checkoutIp: { limit: 5, windowMs: 10 * 60_000 },
  checkoutEmail: { limit: 3, windowMs: 10 * 60_000 },
  order: { limit: 30, windowMs: 60_000 },
  proof: { limit: 5, windowMs: 10 * 60_000 },
  card: { limit: 10, windowMs: 10 * 60_000 },
  /**
   * Оформления с промокодом или сертификатом с одного адреса — и удачные, и
   * с неверным кодом: коды не подобрать перебором, а десяти заказов с кодом
   * в час человеку хватает.
   */
  code: { limit: 10, windowMs: 60 * 60_000 },
  /** Вход через Telegram: с одного адреса и в «Мои заказы» на сайте. */
  tgLogin: { limit: 10, windowMs: 10 * 60_000 },
  myOrders: { limit: 30, windowMs: 60_000 },
  /** Сохранение избранного вошедшего покупателя. */
  favorites: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, Budget>;

export function webSubject(who: string): string {
  return createHash("sha256").update(`ff-web-limit\0${who}`).digest("hex").slice(0, 24);
}

export function takeWeb(
  ctx: TenantContext,
  kind: keyof typeof WEB_BUDGETS,
  who: string,
): Promise<boolean> {
  return takeShared(ctx, `web_${kind}`, webSubject(who), WEB_BUDGETS[kind]);
}
