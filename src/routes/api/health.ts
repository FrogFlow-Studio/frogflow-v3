import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/config/env";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const e = env();
        const { tenantDirectory } = await import("@/core/tenant/resolve.server");
        let tenants = -1;
        let dbError: string | undefined;
        try {
          tenants = (await tenantDirectory()).filter((t) => t.settings.served_by === "v2").length;
        } catch (err) {
          dbError = err instanceof Error ? err.message : String(err);
        }
        return Response.json({
          ok: !dbError,
          version: 2,
          commit: e.VERCEL_GIT_COMMIT_SHA ?? null,
          branch: e.VERCEL_GIT_COMMIT_REF ?? null,
          env: e.VERCEL_ENV ?? "local",
          tenantsOnV2: tenants,
          ...(dbError ? { dbError } : {}),
        });
      },
    },
  },
});
