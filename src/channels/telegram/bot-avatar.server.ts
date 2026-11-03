import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { updateSettingAtomic } from "@/core/settings/settings";
import {
  BOT_AVATAR_KEY,
  botAvatarPath,
  botAvatarStale,
  parseBotAvatar,
  type BotAvatar,
} from "@/core/storefront/bot-avatar";
import { tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";
import { telegramApi, type TelegramApi } from "./api";

type PhotoSize = { file_id: string; file_unique_id: string; width: number; file_size?: number };

/** Больше витрине не нужно: в шапке кружок 36–40 px, на ретине — до 160. */
const WANT_WIDTH = 320;
const MAX_BYTES = 2 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;

export type BotAvatarResult =
  | { action: "skipped" | "fresh" | "none" | "unchanged" | "failed"; reason?: string }
  | { action: "updated"; path: string };

/** Самый маленький размер не уже WANT_WIDTH; нет такого — самый крупный. */
export function pickSize(sizes: PhotoSize[]): PhotoSize | null {
  const sorted = [...sizes].sort((a, b) => a.width - b.width);
  return sorted.find((s) => s.width >= WANT_WIDTH) ?? sorted.at(-1) ?? null;
}

/**
 * Забрать фото бота в Storage, раз в сутки на клиента. Сутки отмечает
 * условная запись до похода в Telegram: два крона одновременно не качают
 * фото дважды. Сбой Telegram или Storage — прежний аватар остаётся,
 * следующая попытка через сутки.
 */
export async function syncBotAvatar(
  tenant: Tenant,
  now = Date.now(),
  deps: { api?: TelegramApi; ctx?: TenantContext } = {},
): Promise<BotAvatarResult> {
  if (!servedByV2(tenant) || !tenant.telegramTokenEnc) return { action: "skipped" };
  const ctx = deps.ctx ?? tenantContext(tenant);
  let prev: BotAvatar | null = null;
  const at = new Date(now).toISOString();
  const claim = await updateSettingAtomic(ctx, BOT_AVATAR_KEY, (raw) => {
    prev = parseBotAvatar(raw, tenant.id);
    if (!botAvatarStale(prev, now)) return null;
    return JSON.stringify({ path: prev?.path ?? null, uid: prev?.uid ?? null, checkedAt: at });
  });
  if (claim === "skipped") return { action: "fresh" };
  if (claim === "failed") return { action: "failed", reason: "claim" };
  const before = prev as BotAvatar | null;

  const api = deps.api ?? telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const me = await api.call<{ id: number }>("getMe");
  if (!me.ok || !me.result) return { action: "failed", reason: "getMe" };
  const photos = await api.call<{ photos: PhotoSize[][] }>("getUserProfilePhotos", {
    user_id: me.result.id,
    limit: 1,
  });
  if (!photos.ok || !photos.result) return { action: "failed", reason: "getUserProfilePhotos" };
  const size = pickSize(photos.result.photos[0] ?? []);
  const save = (path: string | null, uid: string | null) =>
    updateSettingAtomic(ctx, BOT_AVATAR_KEY, () =>
      JSON.stringify({ path, uid, checkedAt: at } satisfies BotAvatar),
    );
  if (!size) {
    // Продавец убрал фото у бота — витрина возвращается к буквам.
    if (before?.path) await save(null, null);
    return { action: "none" };
  }
  const path = botAvatarPath(tenant.id, size.file_unique_id);
  if (before?.path === path) return { action: "unchanged" };
  if (size.file_size && size.file_size > MAX_BYTES) return { action: "failed", reason: "size" };

  const file = await api.call<{ file_path?: string }>("getFile", { file_id: size.file_id });
  if (!file.ok || !file.result?.file_path) return { action: "failed", reason: "getFile" };
  let bytes: ArrayBuffer;
  try {
    const res = await fetch(api.fileUrl(file.result.file_path), {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) return { action: "failed", reason: `download ${res.status}` };
    bytes = await res.arrayBuffer();
  } catch {
    return { action: "failed", reason: "download" };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES)
    return { action: "failed", reason: "size" };
  const up = await serviceDb()
    .storage.from("product-images")
    .upload(path, new Blob([bytes], { type: "image/jpeg" }), {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (up.error) return { action: "failed", reason: `storage: ${up.error.message}` };
  const saved = await save(path, size.file_unique_id);
  if (saved !== "written") return { action: "failed", reason: "save" };
  return { action: "updated", path };
}
