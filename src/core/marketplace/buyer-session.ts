import { createHmac, timingSafeEqual } from "node:crypto";
import type { VerifiedBy, VerifiedIdentity } from "./buyers.server";

/**
 * Вход на площадке (В17): подписанная cookie с id человека (`marketplace_buyers.id`).
 * Её выдаёт только подтверждённый вход в магазин (виджет Telegram или код из бота):
 * подделать без серверного ключа нельзя, срок 30 дней. В ней нет ни баллов, ни заказов.
 */
export const MARKET_SESSION_SEC = 30 * 24 * 3600;
export const MARKET_COOKIE = "ff_market_buyer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mac(secret: string, buyerId: string, exp: number): string {
  return createHmac("sha256", secret).update(`ff-market-buyer\0${buyerId}\0${exp}`).digest("hex");
}

export function signMarketSession(
  secret: string,
  buyerId: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const exp = now + MARKET_SESSION_SEC;
  return `${buyerId}.${exp}.${mac(secret, buyerId, exp)}`;
}

/** id человека из cookie или null: подделка, чужой ключ, срок вышел. */
export function verifyMarketSession(
  secret: string,
  value: string | null | undefined,
  now = Math.floor(Date.now() / 1000),
): string | null {
  const m = /^([0-9a-f-]{36})\.(\d{1,12})\.([0-9a-f]{64})$/i.exec(value ?? "");
  if (!m || !UUID.test(m[1]!)) return null;
  const exp = Number(m[2]);
  if (!Number.isSafeInteger(exp) || exp <= now) return null;
  const a = Buffer.from(mac(secret, m[1]!, exp), "hex");
  const b = Buffer.from(m[3]!, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? m[1]! : null;
}

/**
 * Удостоверение по ключу профиля магазина: `tg_<id>` — Telegram, `wa_<телефон>` — WhatsApp.
 * Instagram и сайт без канала подтверждения аккаунта площадки не дают (null).
 */
export function identityFromUserKey(key: string, via: VerifiedBy): VerifiedIdentity | null {
  const tg = /^tg_([1-9]\d{0,15})$/.exec(key);
  if (tg) return { channel: "telegram", id: tg[1]!, via };
  const wa = /^wa_(\d{5,20})$/.exec(key);
  if (wa) return { channel: "whatsapp", id: wa[1]!, via };
  return null;
}
