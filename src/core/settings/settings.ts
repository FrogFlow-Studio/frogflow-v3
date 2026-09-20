import type { TenantContext } from "@/core/tenant/resolve.server";

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
 * Не upsert: ON CONFLICT требует имени уникального ограничения, а PK
 * app_settings менялся в истории; update-then-insert работает при любом.
 */
export async function setSetting(ctx: TenantContext, key: string, value: string): Promise<void> {
  const { data: existing } = await ctx.db
    .from("app_settings")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    await ctx.db.from("app_settings").update({ value }).eq("key", key);
  } else {
    await ctx.db.from("app_settings").insert({ bot_id: ctx.tenant.id, key, value });
  }
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
