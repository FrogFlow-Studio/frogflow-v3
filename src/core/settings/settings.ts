import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { reportError } from "@/lib/errors";

/** app_settings — KV клиента, PK (bot_id, key). Те же ключи, что в v1. */
export async function getSetting(ctx: TenantContext, key: string): Promise<string | null> {
  const { data } = await ctx.db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function getSettings(
  ctx: TenantContext,
  keys: readonly string[],
): Promise<Record<string, string>> {
  const { data } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .in("key", [...keys]);
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.value != null) out[row.key] = row.value;
  return out;
}

/**
 * Записать настройку из админки. Сбой базы — не «сохранено»: отчёт в Sentry
 * и честная ошибка продавцу на его языке.
 */
export async function setSetting(ctx: TenantContext, key: string, value: string): Promise<void> {
  const failure = await writeSetting(ctx, key, value);
  if (!failure) return;
  await reportError(new Error(`app_settings ${key}: ${failure}`), {
    where: "settings.save",
    botId: ctx.tenant.id,
    extra: { key },
  });
  throw new UserError(
    "err.settings.saveFailed",
    "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
  );
}

/**
 * Служебная запись бота и кронов (счётчики расхода, последняя ошибка):
 * сбой уходит в Sentry, а ответ покупателю не срывается. true — записано.
 */
export async function trySetSetting(
  ctx: TenantContext,
  key: string,
  value: string,
): Promise<boolean> {
  const failure = await writeSetting(ctx, key, value);
  if (failure)
    await reportError(new Error(`app_settings ${key}: ${failure}`), {
      where: "settings.write",
      botId: ctx.tenant.id,
      extra: { key },
    });
  return !failure;
}

/**
 * Не upsert: ON CONFLICT требует имени уникального ограничения, а PK
 * app_settings менялся в истории; update-then-insert работает при любом.
 * Возвращает текст сбоя или null.
 */
async function writeSetting(ctx: TenantContext, key: string, value: string) {
  const found = await ctx.db.from("app_settings").select("key").eq("key", key).maybeSingle();
  if (found.error) return found.error.message;
  if (found.data) return updateSetting(ctx, key, value);
  const { error } = await ctx.db.from("app_settings").insert({ bot_id: ctx.tenant.id, key, value });
  if (!error) return null;
  // Ключ вставили параллельно между чтением и вставкой — дописываем поверх.
  return error.code === "23505" ? updateSetting(ctx, key, value) : error.message;
}

async function updateSetting(ctx: TenantContext, key: string, value: string) {
  const { data, error } = await ctx.db
    .from("app_settings")
    .update({ value })
    .eq("key", key)
    .select("key");
  if (error) return error.message;
  // Без ошибки, но ни одной строки: права арендатора не пустили к записи.
  return data?.length ? null : "строка не обновилась";
}

/** Список Telegram-id из строки «1, 2; 3» без дублей. */
export function parseIdList(raw: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (raw ?? "")
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}
