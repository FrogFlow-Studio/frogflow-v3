/**
 * Массовое действие над любым числом товаров (после «выбрать все по фильтру»):
 * сервер берёт до 500 за вызов, клиент шлёт пачками и складывает итог. Сбой
 * пачки останавливает работу и честно говорит, сколько товаров успели обработать.
 */
export const BULK_BATCH = 500;

export type BulkSummary = {
  changed: number;
  skipped: Array<{ id: string; name: string; reason: string }>;
  stock: Array<{ id: string; name: string; from: number | null; to: number }>;
};

export type BulkRun = BulkSummary & {
  /** Сколько товаров из выбранных уже прошло (изменены или пропущены). */
  processed: number;
  /** Остановились на ошибке пачки; остальные товары не тронуты. */
  error: unknown;
};

export async function runBulkInBatches(
  ids: readonly string[],
  run: (batch: string[]) => Promise<BulkSummary>,
  size = BULK_BATCH,
): Promise<BulkRun> {
  const out: BulkRun = { changed: 0, skipped: [], stock: [], processed: 0, error: null };
  for (let i = 0; i < ids.length; i += size) {
    const batch = ids.slice(i, i + size);
    try {
      const r = await run(batch);
      out.changed += r.changed;
      out.skipped.push(...r.skipped);
      out.stock.push(...r.stock);
      out.processed += batch.length;
    } catch (e) {
      out.error = e;
      break;
    }
  }
  return out;
}
