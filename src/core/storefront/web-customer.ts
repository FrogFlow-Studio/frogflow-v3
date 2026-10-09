import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import {
  getCustomer,
  getCustomerByTelegramId,
  setEmail,
  upsertCustomer,
  type Customer,
} from "@/core/customers/customers";
import { isWebSource } from "./web-source";
import { getSetting } from "@/core/settings/settings";
import {
  parseWebCheckout,
  WEB_CHECKOUT_KEY,
  type WebCheckoutSettings,
} from "./web-checkout-settings";
import { serverFailure } from "@/lib/server-failure";
import { sha256Hex } from "@/lib/hash";

/** Покупатель сайта: почта, ключ, первый источник. */

export async function webCheckoutSettings(ctx: TenantContext): Promise<WebCheckoutSettings> {
  return parseWebCheckout(await getSetting(ctx, WEB_CHECKOUT_KEY));
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** Отпечаток почты: адрес не светится в user_key и синтетическом telegram_id. */
export function webCustomerId(email: string): string {
  return sha256Hex(`web:${email}`, 32);
}

/**
 * Покупатель сайта по почте. Почту никто не подтверждает, поэтому имя и
 * телефон существующего покупателя не перезаписываются: иначе любой, введя
 * чужую почту, подменил бы продавцу контакты. Контакты этого оформления
 * ложатся в сам заказ (placeWebOrder).
 */
export async function webCustomer(
  ctx: TenantContext,
  input: { email: string; name: string; phone: string | null },
): Promise<Customer> {
  const id = webCustomerId(input.email);
  const existing = await getCustomer(ctx, `web_${id}`);
  const c =
    existing ??
    (await upsertCustomer(ctx, "web", id, {
      firstName: input.name.slice(0, 64),
      contactPhone: input.phone,
    }));
  return c.email === input.email ? c : setEmail(ctx, c, input.email);
}

/**
 * Покупатель вошёл на витрину через Telegram: заказ с сайта ложится на того
 * же покупателя, что и в боте (telegram_id и user_key из бота), поэтому в
 * карточке продавца и в «Моих заказах» заказы бота и сайта вместе. Канал
 * заказа остаётся `web`: страница заказа, оплата, письмо и срок неоплаченного
 * работают как у любого заказа с сайта. Почта — его собственная: он вошёл.
 * Нет такого покупателя в боте — null, оформление идёт по почте. То же для покупателя
 * Instagram/WhatsApp, вошедшего по коду: заказ ложится в его карточку, а не в карточку по почте.
 */
export async function telegramWebCustomer(
  ctx: TenantContext,
  telegramId: number,
  email: string,
): Promise<Customer | null> {
  // Telegram или Instagram/WhatsApp (вход по коду, К2): у них `telegram_id` — настоящий или
  // синтетический, и сессия витрины доказывает владение именно им. Покупатель сайта по почте
  // сюда не относится: его карточка не бота.
  const c = await getCustomerByTelegramId(ctx, telegramId);
  if (!c || c.platform === "web" || c.telegramId !== telegramId) return null;
  const withEmail = c.email === email ? c : await setEmail(ctx, c, email);
  return { ...withEmail, platform: "web" };
}

/**
 * Первый источник покупателя с сайта (utm, ref) — в state.first_source, как
 * у бота, и только если источника ещё нет: первая ссылка не перезаписывается.
 * Пишется после оформленного заказа; сбой записи заказ не срывает.
 */
export async function rememberFirstSource(
  ctx: TenantContext,
  customer: Customer,
  source: unknown,
): Promise<void> {
  if (!isWebSource(source)) return;
  try {
    // Условная запись по коротким полям: источника всё ещё нет и шаг
    // диалога тот же (параллельный шаг бота не затираем — перечитываем).
    // Весь state в условие не кладём: он уходит в адрес запроса, и у
    // длинного state PostgREST отвечает 431.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await ctx.db
        .from("bot_users")
        .select("state")
        .eq("user_key", customer.userKey)
        .maybeSingle();
      if (error) throw serverFailure(error.message);
      if (!data) return;
      const state = (data.state ?? {}) as Record<string, unknown>;
      if (state.first_source) return;
      const q = ctx.db
        .from("bot_users")
        .update({ state: { ...state, first_source: source } as Json })
        .eq("user_key", customer.userKey)
        .is("state->>first_source", null);
      const { data: written, error: werr } = await (
        typeof state.mode === "string" && state.mode
          ? q.eq("state->>mode", state.mode)
          : q.is("state->>mode", null)
      ).select("user_key");
      if (werr) throw new Error(werr.message);
      if (written && written.length > 0) return;
    }
    console.warn(`[web-source:${ctx.tenant.id}] источник не записан: его записали параллельно`);
  } catch (e) {
    // Источник — для аналитики продавца, заказ уже оформлен.
    console.warn(`[web-source:${ctx.tenant.id}] источник не записан: ${(e as Error).message}`);
  }
}
