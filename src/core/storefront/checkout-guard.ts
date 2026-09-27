import type { TenantContext } from "@/core/tenant/resolve.server";
import { rateLimiter, type Budget } from "./rate-limit";

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
 * Лимиты частоты в памяти процесса (мягкие, как у Mini App): оформление — с
 * одного адреса и на одну почту; страница заказа и загрузка чека — на заказ.
 */
export const WEB_BUDGETS = {
  checkoutIp: { limit: 5, windowMs: 10 * 60_000 },
  checkoutEmail: { limit: 3, windowMs: 10 * 60_000 },
  order: { limit: 30, windowMs: 60_000 },
  proof: { limit: 5, windowMs: 10 * 60_000 },
  card: { limit: 10, windowMs: 10 * 60_000 },
} as const satisfies Record<string, Budget>;

const web = rateLimiter();

export function takeWeb(botId: string, kind: keyof typeof WEB_BUDGETS, who: string): boolean {
  return web.take(`${botId}:${kind}:${who}`, WEB_BUDGETS[kind]);
}
