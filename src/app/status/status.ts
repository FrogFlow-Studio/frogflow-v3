/**
 * Страница статуса платформы (/status) — для продавцов, без данных клиентов:
 * по каждой службе «работает / с перебоями / нет данных» и дата последнего
 * известного сбоя. Судим по запускам кронов и по сигналам (снимки здоровья
 * ботов, вебхук Zernio, база). Правила — чистые, чтобы их проверяли тесты.
 * Наружу идут только ключ службы, состояние и две даты: ни имён клиентов,
 * ни токенов, ни текстов ошибок.
 */
export type ServiceState = "ok" | "degraded" | "unknown";
export type ServiceStatus = {
  key: string;
  state: ServiceState;
  lastOkAt: string | null;
  /** Последний известный сбой; null — сбоя мы не видели (или он не записывался). */
  lastFailAt: string | null;
};

/** Сигнал вне кронов; readFailed — прочитать источник не удалось (это «нет данных», а не «работает»). */
export type Signal = {
  state: ServiceState;
  readFailed?: boolean;
  lastFailAt?: string | null;
};

type CronLike = { job: string; stale: boolean; last: { at: string; ok: boolean } | null };

/** Службы: по каким задачам и сигналам о них судим. */
export const SERVICES: Array<{ key: string; jobs: string[]; signals?: string[] }> = [
  { key: "telegram", jobs: ["ensure-webhook", "health"], signals: ["telegram_bots"] },
  { key: "instagram", jobs: ["comment-dm-fallback"], signals: ["zernio_webhook"] },
  { key: "whatsapp", jobs: [], signals: ["zernio_webhook"] },
  { key: "payments", jobs: ["subscriptions"], signals: ["database"] },
  { key: "storefront", jobs: [], signals: ["database"] },
  { key: "broadcasts", jobs: ["broadcast"] },
  { key: "reminders", jobs: ["cart-reminder", "fulfillment-reminder", "course-lives"] },
  { key: "vip", jobs: ["vip"] },
  { key: "daily", jobs: ["retention"] },
];

const later = (a: string | null, b: string | null | undefined) => (!b ? a : !a || b > a ? b : a);

export function serviceStatuses(
  /** null — статусы кронов прочитать не удалось: службы с задачами — «нет данных». */
  crons: CronLike[] | null,
  signals: Record<string, Signal> = {},
): ServiceStatus[] {
  const by = new Map((crons ?? []).map((c) => [c.job, c]));
  return SERVICES.map((s) => {
    const runs = s.jobs.map((j) => by.get(j)).filter((c): c is CronLike => Boolean(c?.last));
    const sigs = (s.signals ?? []).map((k) => signals[k] ?? { state: "unknown" as const });
    let lastOkAt: string | null = null;
    let lastFailAt: string | null = null;
    let bad = false;
    let ok = false;
    let unknown = s.jobs.length > 0 && (crons === null || runs.length < s.jobs.length);
    for (const c of runs) {
      if (c.stale || !c.last!.ok) bad = true;
      else ok = true;
      // Дата сбоя — только у упавшего запуска; молчание задачи даёт «перебои» без даты.
      if (!c.last!.ok) lastFailAt = later(lastFailAt, c.last!.at);
      else lastOkAt = later(lastOkAt, c.last!.at);
    }
    for (const g of sigs) {
      if (g.state === "degraded") bad = true;
      else if (g.state === "ok") ok = true;
      else unknown = unknown || Boolean(g.readFailed);
      lastFailAt = later(lastFailAt, g.lastFailAt);
    }
    // Плохое видно всегда; «работает» — только если нет источника, который не прочитался.
    const state: ServiceState = bad ? "degraded" : ok && !unknown ? "ok" : "unknown";
    return { key: s.key, state, lastOkAt, lastFailAt };
  });
}

export function overallState(services: ServiceStatus[]): ServiceState {
  if (services.some((s) => s.state === "degraded")) return "degraded";
  return services.some((s) => s.state === "ok") ? "ok" : "unknown";
}
