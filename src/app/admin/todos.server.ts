import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { localDay } from "@/core/consultant/pricelist/rate-notice.server";
import {
  addTodo,
  loadTodos,
  removeTodo,
  setTodoDone,
  todoView,
  type NewTodo,
} from "@/core/overview/seller-todos";

/**
 * Свои задачи продавца на главной (core/overview/seller-todos). «Сегодня» —
 * по поясу магазина, чтобы вчерашняя задача переехала в сегодня с отметкой
 * в полночь магазина, а не сервера. `me` — чтобы не подписывать свои задачи.
 */
export async function sellerTodos(ctx: TenantContext, me: string | null, now = new Date()) {
  const today = localDay(now, ctx.timezone);
  return { today, me, ...todoView(await loadTodos(ctx), today) };
}

export async function addSellerTodo(ctx: TenantContext, input: NewTodo) {
  return addTodo(ctx, input);
}

const gone = () => new UserError("err.todos.gone", "Задачи уже нет в списке — обновите страницу.");

export async function markSellerTodo(
  ctx: TenantContext,
  id: string,
  done: boolean,
  by: string | null,
) {
  if (!(await setTodoDone(ctx, id, done, by))) throw gone();
  return { ok: true };
}

export async function removeSellerTodo(ctx: TenantContext, id: string) {
  // Повтор удаления (двойной клик) — не ошибка: задачи и так нет.
  await removeTodo(ctx, id);
  return { ok: true };
}
