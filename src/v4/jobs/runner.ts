import type { V4Db } from "../core/db";

/**
 * Исполнитель фоновых задач v4 (v4.jobs, migrations/v4/003 и 012). Берёт
 * задачи своих видов с арендой, отдаёт обработчику и отмечает итог. Общий
 * бюджет меньше 120 с (CLAUDE.md): по его исчерпании новые задачи не берутся,
 * взятые и не начатые возвращаются в очередь при следующем claim по аренде.
 *
 * Обработчик сам отвечает за «один раз»: повтор задачи (ok: false) допустим
 * только если до отправки дело не дошло.
 */

export type Job = {
  id: number;
  botId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type JobOutcome = { ok: true } | { ok: false; error: string; retryInSec?: number };
export type JobHandler = (job: Job, signal: AbortSignal) => Promise<JobOutcome>;

export type RunReport = { done: number; retried: number; budgetLeft: boolean };

export async function runJobs(
  db: V4Db,
  handlers: Record<string, JobHandler>,
  opts: { budgetMs?: number; perJobMs?: number; limit?: number; now?: () => number } = {},
): Promise<RunReport> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? 100_000;
  const perJob = opts.perJobMs ?? 15_000;
  const kinds = Object.keys(handlers);
  const report: RunReport = { done: 0, retried: 0, budgetLeft: true };
  if (!kinds.length) return report;
  const rows = await db.call("claim_jobs", {
    p_limit: opts.limit ?? 20,
    p_lease: "2 minutes",
    p_kinds: kinds,
  });
  for (const r of rows) {
    const job: Job = {
      id: Number(r.id),
      botId: (r.bot_id as string | null) ?? null,
      kind: String(r.kind),
      payload: (r.payload as Record<string, unknown>) ?? {},
      attempts: Number(r.attempts),
    };
    if (now() - started > budget - perJob) {
      // Не начинаем: аренда истечёт, и задача вернётся в очередь без потери попытки… кроме
      // учтённой при claim. Поэтому сразу отдаём её назад как «не успели», с ближайшим повтором.
      await db.call("finish_job", {
        p_id: job.id,
        p_ok: false,
        p_error: "не успели в бюджет",
        p_retry_in: "0 seconds",
      });
      report.budgetLeft = false;
      report.retried++;
      continue;
    }
    let out: JobOutcome;
    try {
      out = await handlers[job.kind]!(job, AbortSignal.timeout(perJob));
    } catch (e) {
      out = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await db.call("finish_job", {
      p_id: job.id,
      p_ok: out.ok,
      p_error: out.ok ? null : out.error.slice(0, 500),
      p_retry_in: `${out.ok ? 0 : (out.retryInSec ?? 300)} seconds`,
    });
    if (out.ok) report.done++;
    else report.retried++;
  }
  return report;
}
