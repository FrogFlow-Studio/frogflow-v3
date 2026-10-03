import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { pageAll } from "@/core/db/page";
import type { TaskGate } from "./access";
import { HW_KEY_PREFIX, parseHomework } from "./homework";
import { QUIZ_KEY_PREFIX, parseQuizResult } from "./lesson-quiz";

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

/** id урока из ключа `quiz_<позиция>_<урок>`. */
const quizLesson = (key: string, orderItemId: string) =>
  key.slice(`${QUIZ_KEY_PREFIX}${orderItemId}_`.length);

/**
 * Уроки с пройденным тестом (А25) для режима «по заданиям»: пройденный тест
 * открывает следующий урок, как принятое задание. Сбой чтения — ошибка.
 */
export async function loadQuizPassed(
  ctx: TenantContext,
  orderItemId: string,
): Promise<TaskGate["quiz"]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .like("key", `${QUIZ_KEY_PREFIX}${orderItemId}_%`)
    .order("key");
  if (error) throw serverFailure(`Результаты тестов не прочитаны: ${error.message}`);
  const out = new Set<string>();
  for (const r of data ?? [])
    if (parseQuizResult(r.value).passed) out.add(quizLesson(r.key, orderItemId));
  return out;
}

/** То же для многих покупок сразу: один постраничный обход, раскладка по позициям. */
export async function loadQuizPassedFor(
  ctx: TenantContext,
  orderItemIds: readonly string[],
): Promise<Map<string, TaskGate["quiz"]>> {
  const out = new Map<string, Set<string>>();
  if (orderItemIds.length === 0) return out;
  const wanted = new Set(orderItemIds);
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${QUIZ_KEY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "результаты тестов",
  );
  for (const r of rows) {
    if (!parseQuizResult(r.value).passed) continue;
    const rest = r.key.slice(QUIZ_KEY_PREFIX.length);
    const sep = rest.indexOf("_");
    const item = sep < 0 ? "" : rest.slice(0, sep);
    if (!wanted.has(item)) continue;
    const set = out.get(item) ?? new Set<string>();
    set.add(rest.slice(sep + 1));
    out.set(item, set);
  }
  return out;
}
