import { pageAll } from "@/core/db/page";
import { autoMessagesV3 } from "@/core/marketing/auto-v3";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { LAST_RUN_PREFIX, clearWaitlistRun, inStock, parseLastRun } from "@/core/waitlist/waitlist";
import { inChunks } from "@/lib/in-chunks";
import { notifyBackInStock } from "./notify.server";

/** Общий бюджет догоняющей рассылки на магазин: функция крона живёт 120 с, у неё много задач. */
export const CATCHUP_BUDGET_MS = 45_000;

export type CatchupResult =
  | { skipped: "module off" | "auto messages off" }
  | { products: number; notified: number; failed: number; left: number };

/**
 * Догоняющая рассылка листа ожидания (К4). Первая рассылка идёт при возврате товара в продажу;
 * тем, кого она не успела (вышел бюджет времени) или кому не хватило места в общем суточном
 * потолке маркетинга, уходит здесь, раз в час, пока товар в наличии. Не пересылает: кто уже
 * получил, из списка убран (claimWaitlistNotice), место в потолке занимается до отправки.
 * Берёт только товары с «осталось» в итоге последней рассылки (app_settings `waitlist_last:*`).
 * Новое автосообщение — работает, только когда продавец включил «Новые автосообщения».
 */
export async function runWaitlistCatchup(
  ctx: TenantContext,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<CatchupResult> {
  if (!ctx.tenant.modules.waitlist) return { skipped: "module off" };
  if (!(await autoMessagesV3(ctx))) return { skipped: "auto messages off" };
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? CATCHUP_BUDGET_MS;
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .like("key", `${LAST_RUN_PREFIX}%`)
        .order("key", { ascending: true })
        .range(from, to),
    "Лист ожидания: итоги рассылок",
  );
  const pending = rows
    .filter((r) => (parseLastRun(r.value ?? undefined)?.left ?? 0) > 0)
    .map((r) => r.key.slice(LAST_RUN_PREFIX.length));
  const total = { products: 0, notified: 0, failed: 0, left: 0 };
  if (pending.length === 0) return total;
  const products = await inChunks(
    pending,
    (chunk) =>
      ctx.db.from("products").select("id, name, is_active, stock_quantity").in("id", chunk),
    "Лист ожидания: товары",
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const id of pending) {
    const left = budget - (clock() - started);
    if (left <= 0) break;
    const p = byId.get(id);
    if (!p) {
      // Товар удалён: ждать нечего, итог сбрасываем.
      await clearWaitlistRun(ctx, id, clock());
      continue;
    }
    // Не в наличии — ждём: итог остаётся, догоним, когда вернётся.
    if (!inStock({ is_active: p.is_active, stock_quantity: p.stock_quantity })) continue;
    const r = await notifyBackInStock(ctx, { id, name: p.name }, { budgetMs: left });
    total.products++;
    total.notified += r.notified;
    total.failed += r.failed;
    total.left += r.left;
    // Ждущих не осталось вовсе (всё разослано другим запуском): итог сбрасываем.
    if (r.notified + r.failed + r.left === 0) await clearWaitlistRun(ctx, id, clock());
  }
  return total;
}
