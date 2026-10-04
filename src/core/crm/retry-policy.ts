import type { CrmOutcome } from "./log";

/**
 * Сами не повторяются, ждут ручного повтора: таймаут, обрыв и 5xx (4xx и «не ушло»
 * очередь повторяет сама, пока не сдастся).
 */
export const needsManualRetry = (e: { outcome: CrmOutcome; status: number | null }) =>
  e.outcome === "timeout" ||
  e.outcome === "network" ||
  (e.outcome === "http" && (e.status ?? 0) >= 500);
