import { createFileRoute } from "@tanstack/react-router";

/** CSV отчёта из «Центра отчётов» (то же, что на экране): из сессии админа, без контактов покупателей. */
export const Route = createFileRoute("/api/admin/reports/$kind")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireAdminFinance } = await import("@/app/auth/guards.server");
        const { REPORT_KINDS, REPORT_PERIODS, availableReports, centerReport, reportCsv } =
          await import("@/core/reports/center");
        let ctx;
        let accountant;
        try {
          ({ ctx, accountant } = await requireAdminFinance());
        } catch (e) {
          const { isUserError } = await import("@/core/i18n/user-error");
          return isUserError(e)
            ? new Response("forbidden", { status: 403 })
            : new Response("unauthorized", { status: 401 });
        }
        const kind = REPORT_KINDS.find((k) => k === params.kind);
        if (!kind) return new Response("not found", { status: 404 });
        if (!availableReports(ctx.tenant.modules, accountant).includes(kind))
          return new Response("forbidden", { status: 403 });
        const d = Number(new URL(request.url).searchParams.get("days"));
        const days = REPORT_PERIODS.find((p) => p === d) ?? 30;
        const { adminTFor } = await import("@/app/admin/locale.server");
        const t = await adminTFor(ctx);
        const result = reportCsv(
          await centerReport(ctx, kind, days),
          (k, key) => t(`reports.${k}.${key}` as never),
          {
            metric: t("reports.h.metric"),
            current: t("reports.h.current"),
            previous: t("reports.h.previous"),
            change: t("reports.h.change"),
          },
        );
        const today = new Date().toISOString().slice(0, 10);
        return new Response(result.csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="report-${kind}-${days}d-${today}.csv"`,
            "x-row-count": String(result.count),
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
