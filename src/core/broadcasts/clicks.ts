import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingAtomic } from "@/core/settings/settings";

/**
 * Клики по кнопкам рассылки. Кнопки Telegram-рассылки — callback, а не
 * ссылки: к callback_data дописывается метка рассылки `:b<8 символов id>`
 * (влезает в 64 байта рядом с uuid товара), бот считает нажатие и дальше
 * ведёт себя как без метки. Счётчик — строка app_settings
 * `broadcast_clicks:<метка>`, прибавляется атомарно.
 */
export const CLICKS_PREFIX = "broadcast_clicks:";

export function clickMark(broadcastId: string): string {
  return `b${broadcastId.replace(/-/g, "").slice(0, 8)}`;
}

/** callback_data без метки и сама метка (или null). */
export function splitClickMark(data: string): { data: string; mark: string | null } {
  const m = /^(.*):(b[0-9a-f]{8})$/.exec(data);
  return m ? { data: m[1]!, mark: m[2]! } : { data, mark: null };
}

export async function recordClick(ctx: TenantContext, mark: string): Promise<void> {
  if (!/^b[0-9a-f]{8}$/.test(mark)) return;
  await updateSettingAtomic(ctx, `${CLICKS_PREFIX}${mark}`, (raw) =>
    String((Number(raw) || 0) + 1),
  );
}

/** Клики по рассылкам: id рассылки → число нажатий. */
export async function clicksFor(
  ctx: TenantContext,
  broadcastIds: string[],
): Promise<Record<string, number>> {
  if (broadcastIds.length === 0) return {};
  const byMark = new Map(broadcastIds.map((id) => [`${CLICKS_PREFIX}${clickMark(id)}`, id]));
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .in("key", [...byMark.keys()]);
  if (error) throw serverFailure(`Рассылки: клики: ${error.message}`);
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    const id = byMark.get(r.key);
    if (id) out[id] = Number(r.value) || 0;
  }
  return out;
}
