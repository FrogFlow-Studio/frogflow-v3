/**
 * Страница статуса платформы (/status) — для продавцов, без данных клиентов:
 * по каждой службе «работает / с перебоями» из последних запусков кронов и
 * доступности базы. Правила — чистые, чтобы их проверяли тесты.
 */
export type ServiceState = "ok" | "degraded" | "unknown";

export type ServiceStatus = { key: string; state: ServiceState; lastOkAt: string | null };

type CronLike = { job: string; stale: boolean; last: { at: string; ok: boolean } | null };

/** Службы и задачи, по которым о них судим. */
export const SERVICES: Array<{ key: string; jobs: string[] }> = [
  { key: "bots", jobs: ["ensure-webhook", "health"] },
  { key: "broadcasts", jobs: ["broadcast"] },
  { key: "reminders", jobs: ["cart-reminder", "fulfillment-reminder"] },
  { key: "instagram", jobs: ["comment-dm-fallback"] },
  { key: "vip", jobs: ["vip"] },
  { key: "daily", jobs: ["subscriptions", "retention"] },
];

export function serviceStatuses(crons: CronLike[]): ServiceStatus[] {
  const by = new Map(crons.map((c) => [c.job, c]));
  return SERVICES.map((s) => {
    const runs = s.jobs.map((j) => by.get(j)).filter((c): c is CronLike => Boolean(c));
    if (runs.length === 0 || runs.every((c) => !c.last))
      return { key: s.key, state: "unknown", lastOkAt: null };
    const bad = runs.some((c) => c.stale || !c.last?.ok);
    const okTimes = runs
      .filter((c) => c.last?.ok)
      .map((c) => c.last!.at)
      .sort();
    return { key: s.key, state: bad ? "degraded" : "ok", lastOkAt: okTimes.at(-1) ?? null };
  });
}

export function overallState(db: boolean, services: ServiceStatus[]): ServiceState {
  if (!db) return "degraded";
  return services.some((s) => s.state === "degraded") ? "degraded" : "ok";
}
