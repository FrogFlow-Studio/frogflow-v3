import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { claimOrderEvent } from "./events";

/**
 * «Это подарок» (модуль `bundles`): покупатель отмечает заказ подарком, называет
 * получателя и пишет текст открытки. Хранение — событие заказа `order.gift`
 * (core/orders/events), один раз на заказ: своей колонки нет. Имя — до 100
 * символов, открытка — до 300; длиннее режется на сервере, а покупателю
 * говорится об этом (`truncated`), а не молча.
 */
export const GIFT_NAME_MAX = 100;
export const GIFT_MESSAGE_MAX = 300;

export type OrderGift = { recipient: string; message: string; truncated: boolean };

const cut = (s: string, max: number): [string, boolean] => {
  const chars = Array.from(s);
  return chars.length > max ? [chars.slice(0, max).join("").trimEnd(), true] : [s, false];
};

/** Отметка «подарок» с подчищенными полями; вызывать только когда покупатель подарок отметил. */
export function normalizeGift(input: {
  recipient?: string | null;
  message?: string | null;
}): OrderGift {
  const [recipient, nameCut] = cut(
    (input.recipient ?? "").replace(/\s+/g, " ").trim(),
    GIFT_NAME_MAX,
  );
  const [message, textCut] = cut((input.message ?? "").trim(), GIFT_MESSAGE_MAX);
  return { recipient, message, truncated: nameCut || textCut };
}

/** Записать подарок заказа (один раз на заказ: повторный вызов ничего не меняет). */
export async function recordOrderGift(
  ctx: TenantContext,
  orderId: number,
  gift: OrderGift,
  /** Сумма подарочной упаковки в заказе (0 — не взята): видна в журнале. */
  wrap = 0,
): Promise<boolean> {
  return claimOrderEvent(ctx, orderId, "gift", "once", {
    recipient: gift.recipient,
    message: gift.message,
    truncated: gift.truncated,
    ...(wrap > 0 ? { wrap } : {}),
  });
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : "");

/** Подарок из payload события; не подарок — null. */
export function giftFromPayload(p: Record<string, Json | undefined> | null): OrderGift | null {
  if (!p) return null;
  return { recipient: str(p.recipient), message: str(p.message), truncated: p.truncated === true };
}

/** Подарок заказа; нет отметки — null, сбой чтения — serverFailure («не прочитали» ≠ «не подарок»). */
export async function loadOrderGift(
  ctx: TenantContext,
  orderId: number,
): Promise<OrderGift | null> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .eq("event_id", `order:${orderId}:gift:once`)
    .maybeSingle();
  if (error) throw serverFailure(`Подарок заказа #${orderId}: ${error.message}`);
  if (!data) return null;
  const p = data.payload;
  return giftFromPayload(p && typeof p === "object" && !Array.isArray(p) ? p : null);
}

/**
 * Спрашивать ли «это подарок?» в Direct/WhatsApp: там нет кнопки корзины, и вопрос
 * задаётся каждому покупателю, поэтому по умолчанию выключен — продавец включает
 * его в «Настройки → Подарочная упаковка» (app_settings `gift_ask` = "1").
 * Не прочитали настройку — не спрашиваем: пропущенный вопрос заказ не ломает.
 */
export const GIFT_ASK_KEY = "gift_ask";

export async function giftAskOn(ctx: TenantContext): Promise<boolean> {
  if (!ctx.tenant.modules.bundles) return false;
  return (await getSetting(ctx, GIFT_ASK_KEY)) === "1";
}

export async function saveGiftAsk(ctx: TenantContext, on: boolean): Promise<void> {
  await setSetting(ctx, GIFT_ASK_KEY, on ? "1" : "0");
}
