import { withNoStore } from "@/app/cache-policy";
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
        let storage: Record<string, unknown> | undefined;
        try {
          const { serviceDb } = await import("@/core/db/client.server");
          const { data: bData, error: bErr } = await serviceDb().storage.getBucket("product-files");
          storage = {
            productFiles: bData ?? null,
            ...(bErr ? { bucketError: bErr.message } : {}),
          };
        } catch (err) {
          storage = { error: err instanceof Error ? err.message : String(err) };
        }

        let kopilka: Record<string, unknown> | undefined;
        try {
          const { resolveTenant, tenantContext } = await import("@/core/tenant/resolve.server");
          const tenant = await resolveTenant({ by: "id", value: "4f9562e2-3bf4-4cba-8a58-794637511431" });
          if (tenant) {
            const { robokassaFor } = await import("@/core/payments/payment");
            const { getSettingsStrict } = await import("@/core/settings/settings");
            const { ROBOKASSA_KEYS } = await import("@/core/payments/robokassa");
            const tCtx = tenantContext(tenant);
            const rkSettings = await getSettingsStrict(tCtx, ROBOKASSA_KEYS);
            const kztCheck = await robokassaFor(tCtx, "KZT");
            const rubCheck = await robokassaFor(tCtx, "RUB");
            kopilka = {
              modulesRobokassa: tenant.modules.robokassa,
              rkSettings: {
                enabled: rkSettings.robokassa_enabled,
                region: rkSettings.robokassa_region,
                testMode: rkSettings.robokassa_test_mode,
                hasLogin: Boolean(rkSettings.robokassa_login?.trim()),
                hasPass1: Boolean(rkSettings.robokassa_pass1?.trim()),
                hasPass2: Boolean(rkSettings.robokassa_pass2?.trim()),
                hasPass1Test: Boolean(rkSettings.robokassa_pass1_test?.trim()),
                hasPass2Test: Boolean(rkSettings.robokassa_pass2_test?.trim()),
              },
              kztCheck,
              rubCheck,
            };
          }
        } catch (err) {
          kopilka = { error: err instanceof Error ? err.message : String(err) };
        }

        return withNoStore(
          Response.json({
            ok: !dbError && report.ok,
            version: 3,
            commit: e?.VERCEL_GIT_COMMIT_SHA ?? null,
            branch: e?.VERCEL_GIT_COMMIT_REF ?? null,
            env: e?.VERCEL_ENV ?? "local",
            envReport: report,
            tenantsOnV2: tenants,
            storage,
            kopilka,
            ...(dbError ? { dbError } : {}),
          }),
        );
      },
    },
  },
});
