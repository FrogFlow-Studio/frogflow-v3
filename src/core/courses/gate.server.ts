import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { pageAll } from "@/core/db/page";
import type { TaskGate } from "./access";
import { HW_KEY_PREFIX, parseHomework } from "./homework";

/**
 * Статусы сдач ДЗ одной покупки по id урока — для режима «по заданиям»: от
 * них зависит, какие уроки открыты. Сбой чтения — ошибка, а не «ничего не
 * сдано»: иначе ученику закрылись бы уже открытые уроки.
 */
export async function loadHwStatuses(
  ctx: TenantContext,
  orderItemId: string,
): Promise<TaskGate["hw"]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .like("key", `${HW_KEY_PREFIX}${orderItemId}_%`)
    .order("key");
  if (error) throw serverFailure(`Сдачи заданий не прочитаны: ${error.message}`);
  const out = new Map<string, "submitted" | "accepted" | "revise">();
  for (const r of data ?? []) {
    const hw = parseHomework(r.value);
    if (hw && hw.orderItemId === orderItemId) out.set(hw.lessonId, hw.status);
  }
  return out;
}

/**
 * То же для многих покупок сразу (кроны, список учеников): сдачи читаются
 * постранично одним обходом и раскладываются по позициям.
 */
export async function loadHwStatusesFor(
  ctx: TenantContext,
  orderItemIds: readonly string[],
): Promise<Map<string, TaskGate["hw"]>> {
  const out = new Map<string, Map<string, "submitted" | "accepted" | "revise">>();
  if (orderItemIds.length === 0) return out;
  const wanted = new Set(orderItemIds);
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${HW_KEY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "сдачи заданий",
  );
  for (const r of rows) {
    const hw = parseHomework(r.value);
    if (!hw || !wanted.has(hw.orderItemId)) continue;
    const m = out.get(hw.orderItemId) ?? new Map();
    m.set(hw.lessonId, hw.status);
    out.set(hw.orderItemId, m);
  }
  return out;
}
