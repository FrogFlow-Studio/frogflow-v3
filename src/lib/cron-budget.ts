/**
 * Общий бюджет времени крона. Функция Vercel живёт 120 с (vite.config.ts), и
 * крон, который упёрся в предел, обрывается на полуслове: клиенты в конце
 * списка не обработаны никогда. Здесь работа по клиентам останавливается на
 * бюджете, а следующий запуск начинает с первого пропущенного (`resume` в
 * учёте крона), поэтому очередь движется по кругу и никто не голодает.
 * Дубля нет: отметки «сделано» ставятся условной записью до отправки
 * (CLAUDE.md, «Один раз»), повторный обход клиента безопасен.
 */
export const CRON_BUDGET_MS = 100_000;
/** После бюджета ждём уже идущего клиента ещё столько, потом считаем «не уложился». */
export const CRON_GRACE_MS = 10_000;
/** Клиентов одновременно в параллельных кронах. */
export const CRON_CONCURRENCY = 10;

export type CronBudget = { left(): number; spent(): boolean };

export function cronBudget(
  startedAt: number,
  totalMs = CRON_BUDGET_MS,
  now: () => number = Date.now,
): CronBudget {
  const left = () => Math.max(0, startedAt + totalMs - now());
  return { left, spent: () => left() === 0 };
}

/**
 * Порядок обхода: по id (стабильно между запусками), начиная с `resumeFrom`
 * и по кругу. `sorted: false` — список уже в нужном порядке (этапы), тогда
 * начало ищется по точному совпадению.
 */
export function inTurn<T extends { id: string }>(
  items: readonly T[],
  resumeFrom: string | null,
  sorted = true,
): T[] {
  const list = [...items];
  if (sorted) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!resumeFrom) return list;
  const at = list.findIndex((i) => (sorted ? i.id >= resumeFrom : i.id === resumeFrom));
  return at <= 0 ? list : [...list.slice(at), ...list.slice(0, at)];
}

/** С чего начать следующий запуск: первый из `ordered`, кого пропустили. */
export function resumeOf(ordered: readonly { id: string }[], skipped: ReadonlySet<string>) {
  return ordered.find((i) => skipped.has(i.id))?.id ?? null;
}

/** Последовательно, пока есть бюджет; кого не начали — в `skipped`. */
export async function eachWithin<T extends { id: string }>(
  items: readonly T[],
  budget: CronBudget,
  skipped: Set<string>,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (const item of items) {
    if (budget.spent()) skipped.add(item.id);
    else await fn(item);
  }
}

export type Settled<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown }
  | { status: "skipped" };

/**
 * Параллельно, не больше `concurrency` клиентов разом. Не начатые к концу
 * бюджета — `skipped`. Идущий дольше бюджета + CRON_GRACE_MS считается не
 * уложившимся: ответ крона не ждёт его (работа идёт до обрыва функции, отметки
 * условные), а следующий запуск начнёт с него.
 */
export async function mapWithin<T extends { id: string }, R>(
  items: readonly T[],
  budget: CronBudget,
  skipped: Set<string>,
  run: (item: T) => Promise<R>,
  concurrency = CRON_CONCURRENCY,
): Promise<Map<string, Settled<R>>> {
  const out = new Map<string, Settled<R>>();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const item = items[next++];
      if (!item) return;
      if (budget.spent()) {
        skipped.add(item.id);
        out.set(item.id, { status: "skipped" });
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const started = run(item);
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), budget.left() + CRON_GRACE_MS);
      });
      try {
        const r = await Promise.race([started, late]);
        if (r === "late") {
          started.catch(() => undefined);
          skipped.add(item.id);
          out.set(item.id, {
            status: "rejected",
            reason: new Error("не уложился в бюджет крона"),
          });
        } else out.set(item.id, { status: "fulfilled", value: r });
      } catch (reason) {
        out.set(item.id, { status: "rejected", reason });
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
