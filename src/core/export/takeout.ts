import { createHmac, timingSafeEqual } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { allDataZip } from "./export";

/**
 * «Забрать мои данные»: архив магазина по подписанной ссылке на 24 часа.
 * Подпись — HMAC платформенного секрета по клиенту и сроку, так что ссылка
 * одного магазина не открывает архив другого, а после срока не работает.
 * Секрет передаёт вызывающий (ядро не читает окружение).
 */
export const TAKEOUT_TTL_S = 24 * 60 * 60;
const SIG_LEN = 32;

const sign = (secret: string, tenantId: string, exp: number) =>
  createHmac("sha256", secret)
    .update(`takeout:${tenantId}:${exp}`)
    .digest("base64url")
    .slice(0, SIG_LEN);

export function takeoutLink(
  secret: string,
  tenantId: string,
  now = new Date(),
): { path: string; expiresAt: string } {
  const exp = Math.floor(now.getTime() / 1000) + TAKEOUT_TTL_S;
  return {
    path: `/api/takeout/${tenantId}?e=${exp}&k=${sign(secret, tenantId, exp)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type TakeoutCheck = "ok" | "expired" | "invalid";

export function checkTakeout(
  secret: string,
  tenantId: string,
  e: string | null,
  k: string | null,
  now = new Date(),
): TakeoutCheck {
  if (!e || !/^\d{9,12}$/.test(e) || !k || k.length !== SIG_LEN) return "invalid";
  const exp = Number(e);
  const want = Buffer.from(sign(secret, tenantId, exp));
  const got = Buffer.from(k);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return "invalid";
  return Math.floor(now.getTime() / 1000) > exp ? "expired" : "ok";
}

/** Ключи настроек, которые в архив не идут: пароли, токены, секреты, ключи доступа. */
const SECRET_KEY = /pass|hash|token|secret|key|_enc$|salt|credential/i;
/** Целые ветки: вход в админку (логины и хеши паролей команды) и служебная привязка каналов. */
const DROPPED = new Set(["admin", "zernio", "billing", "deletion"]);

/** Настройки магазина без секретов: рекурсивно убираем всё, что похоже на ключ или пароль. */
export function exportableSettings(value: unknown, top = true): unknown {
  if (Array.isArray(value)) return value.map((v) => exportableSettings(v, false));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((top && DROPPED.has(k)) || SECRET_KEY.test(k)) continue;
      out[k] = exportableSettings(v, false);
    }
    return out;
  }
  return value;
}

export const TAKEOUT_README = [
  "Архив данных магазина (FrogFlow).",
  "",
  "orders.csv, order_items.csv — заказы и их позиции.",
  "customers.csv — покупатели магазина.",
  "products.csv — каталог.",
  "settings.json — настройки магазина без паролей, токенов и ключей.",
  "",
  "Кодировка CSV — UTF-8 с BOM, разделитель «;»: открывается в Excel.",
  "В архиве только данные вашего магазина.",
].join("\n");

/** Архив: CSV заказов, позиций, покупателей, каталога (постранично) и настройки. */
export async function takeoutZip(
  ctx: TenantContext,
  now = new Date(),
): Promise<{ zip: Buffer; counts: Record<string, number> }> {
  const settings = {
    name: ctx.tenant.name,
    vertical: ctx.tenant.vertical,
    exported_at: now.toISOString(),
    settings: exportableSettings(ctx.tenant.settings),
  };
  return allDataZip(ctx, now, [
    { name: "settings.json", data: JSON.stringify(settings, null, 2) },
    { name: "README.txt", data: TAKEOUT_README },
  ]);
}
