import { createServerFn } from "@tanstack/react-start";

/** Публичный статус платформы: без данных клиентов (app/status/status). */
export const platformStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  const db = await tenantDirectory()
    .then(() => true)
    .catch(() => false);
  const { listCronStatus } = await import("@/app/operator/cron-status.server");
  const crons = await listCronStatus().catch(() => []);
  const { serviceStatuses, overallState } = await import("./status");
  const services = serviceStatuses(crons);
  return { at: new Date().toISOString(), db, overall: overallState(db, services), services };
});
