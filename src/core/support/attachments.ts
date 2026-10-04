import type { Json } from "@/core/db-types";
import { isTenantStorageKey } from "@/core/storage/keys";
import { isIssuedUploadKey } from "@/core/storage/upload";
import type { MessageRow } from "./support";

/**
 * Вложение и контекст сообщения поддержки (Ч3). Скриншот — тот же вид
 * загрузки, что и фото в «Чате» (JPEG/PNG до 5 МБ, ключ под префиксом
 * магазина); контекст — страница, с которой нажали «Поддержка», и номер
 * заказа, если открыт заказ. Чистая часть: проверка ключа и контекста.
 */
const PHOTO_EXT = /\.(jpe?g|png)$/i;
const SHOT_TTL_SEC = 600;
const PAGE_MAX = 200;

/** Ключ выдан этому магазину правилом загрузок и это картинка. */
export function isOwnScreenshotKey(botId: string, key: string): boolean {
  return isIssuedUploadKey(botId, key) && PHOTO_EXT.test(key);
}

export type MessageContext = { page: string | null; orderNo: number | null };

/**
 * Контекст из слов браузера: страница — только путь админки без запроса и
 * якоря, номер заказа — натуральное число. Остальное отбрасываем: то, что
 * пришло извне, в базу «как есть» не кладётся. Пусто — null.
 */
export function cleanContext(
  input: { page?: unknown; orderNo?: unknown } | null | undefined,
): Json | null {
  const raw = typeof input?.page === "string" ? input.page.split(/[?#]/)[0]!.trim() : "";
  const page =
    raw.length <= PAGE_MAX && /^\/admin(\/[A-Za-z0-9._~-]*)*$/.test(raw) ? raw || "/admin" : null;
  const no = input?.orderNo;
  const orderNo = typeof no === "number" && Number.isInteger(no) && no > 0 && no < 1e9 ? no : null;
  if (!page && orderNo === null) return null;
  return { page, order_no: orderNo };
}

export function readContext(v: Json | null): MessageContext | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, Json | undefined>;
  const page = typeof o.page === "string" ? o.page : null;
  const orderNo = typeof o.order_no === "number" ? o.order_no : null;
  return page || orderNo !== null ? { page, orderNo } : null;
}

/**
 * Подписанные ссылки на скриншоты (на 10 минут). Каждый ключ проверяется на
 * префикс магазина-автора сообщения: ключ с чужим bot_id ссылки не получает.
 * Сбой подписи не ломает чат — картинки просто нет.
 */
export async function signScreenshots(rows: readonly MessageRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const own = rows.filter(
    (r) => r.attachment_key && isTenantStorageKey(r.bot_id, r.attachment_key),
  );
  if (own.length === 0) return out;
  const { serviceDb } = await import("@/core/db/client.server");
  const bucket = serviceDb().storage.from("product-images");
  await Promise.all(
    own.map(async (r) => {
      try {
        const { data } = await bucket.createSignedUrl(r.attachment_key!, SHOT_TTL_SEC);
        if (data?.signedUrl) out.set(r.id, data.signedUrl);
      } catch (e) {
        console.error("[support] ссылка на скриншот", e instanceof Error ? e.message : e);
      }
    }),
  );
  return out;
}
