import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { loadTasks, TASKS_KEY } from "./tasks";

/**
 * Бейдж «Задачи» в шапке админки. Шапка грузится на каждой странице, а список
 * задач — JSON до 200 строк: читать его каждый раз дорого. Сначала читаем
 * только `updated_at` строки; пока он тот же (каждая запись задач его
 * повышает, `updateSettingStamped`), счёт берётся из памяти функции. Срок
 * памяти ограничен: запись без отметки времени (v1) устареет не дольше, чем на
 * `TTL_MS`. Без отметки — счёт не запоминается вовсе.
 */
const TTL_MS = 2 * 60_000;
const MAX_ENTRIES = 500;
const cache = new Map<string, { stamp: string; at: number; open: number }>();

/** Сколько открытых задач. Сбой чтения — ошибка, а не «0». */
export async function openTasksCount(ctx: TenantContext, now = Date.now()): Promise<number> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("updated_at")
    .eq("key", TASKS_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`задачи консультанта не прочитаны: ${error.message}`);
  if (!data) return 0;
  const stamp = (data as { updated_at?: string | null }).updated_at ?? null;
  const hit = cache.get(ctx.tenant.id);
  if (stamp && hit && hit.stamp === stamp && now - hit.at < TTL_MS) return hit.open;
  const open = (await loadTasks(ctx)).filter((t) => !t.done).length;
  if (stamp) {
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(ctx.tenant.id, { stamp, at: now, open });
  }
  return open;
}
