import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * «Что сделать сегодня» на главной админки: сколько ждёт решения продавца.
 * Каждая строка считается отдельно: сбой чтения одной даёт `count: null`
 * («не удалось определить»), а не «0» и не обрушивает остальные.
 */
export type TodayKey = "receipts" | "newOrders" | "ready" | "dialogs" | "tickets" | "lowStock";
export type TodayTask = { key: TodayKey; count: number | null };

/** Статусы заказа, которые ждут продавца: чек на проверке, новый, готов к выдаче. */
const ORDER_TASKS: [TodayKey, string][] = [
  ["receipts", "awaiting_confirmation"],
  ["newOrders", "accepted"],
  ["ready", "ready"],
];

async function countOrders(ctx: TenantContext, status: string): Promise<number> {
  const { count, error } = await ctx.db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  if (error) throw serverFailure(`Задачи дня: ${error.message}`);
  return count ?? 0;
}

async function attempt(
  ctx: TenantContext,
  key: TodayKey,
  read: () => Promise<number>,
): Promise<TodayTask> {
  try {
    return { key, count: await read() };
  } catch (e) {
    console.error(`[today:${ctx.tenant.id}] ${key}`, e instanceof Error ? e.message : e);
    return { key, count: null };
  }
}

export async function todayTasks(ctx: TenantContext): Promise<TodayTask[]> {
  const m = ctx.tenant.modules;
  const jobs: Promise<TodayTask>[] = ORDER_TASKS.map(([key, status]) =>
    attempt(ctx, key, () => countOrders(ctx, status)),
  );
  if (m.manager_chat)
    jobs.push(
      attempt(ctx, "dialogs", async () => (await import("@/core/chat/chat")).totalUnread(ctx)),
    );
  if (m.helpdesk && m.manager_chat)
    jobs.push(
      attempt(ctx, "tickets", async () =>
        (await import("@/core/helpdesk/tickets")).countOpenTickets(ctx),
      ),
    );
  if (m.stock)
    jobs.push(
      attempt(ctx, "lowStock", async () =>
        (await import("@/core/catalog/low-stock")).listLowStock(ctx).then((l) => l.length),
      ),
    );
  return showable(await Promise.all(jobs));
}

/** Нулевые задачи не показываем; «не удалось определить» остаётся на виду. Порядок — как в ORDER. */
const ORDER: TodayKey[] = ["receipts", "newOrders", "ready", "dialogs", "tickets", "lowStock"];
export function showable(tasks: TodayTask[]): TodayTask[] {
  return tasks
    .filter((t) => t.count === null || t.count > 0)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
}
