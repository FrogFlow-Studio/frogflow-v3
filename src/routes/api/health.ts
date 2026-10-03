import { createFileRoute } from "@tanstack/react-router";
import { env, envPresence } from "@/config/env";
import { envReport } from "@/lib/env-report";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const report = envReport(envPresence());
        // Без обязательной переменной env() бросает: отчёт всё равно отдаём.
        let e: ReturnType<typeof env> | undefined;
        try {
          e = env();
        } catch {
          e = undefined;
        }
        const { tenantDirectory } = await import("@/core/tenant/resolve.server");
        let tenants = -1;
        let dbError: string | undefined;
        try {
          tenants = (await tenantDirectory()).filter((t) => t.settings.served_by === "v2").length;
        } catch (err) {
          dbError = err instanceof Error ? err.message : String(err);
        }
        return Response.json({
          ok: !dbError && report.ok,
          version: 3,
          commit: e?.VERCEL_GIT_COMMIT_SHA ?? null,
          branch: e?.VERCEL_GIT_COMMIT_REF ?? null,
          env: e?.VERCEL_ENV ?? "local",
          envReport: report,
          tenantsOnV2: tenants,
          ...(dbError ? { dbError } : {}),
        });
      },
    },
  },
});
