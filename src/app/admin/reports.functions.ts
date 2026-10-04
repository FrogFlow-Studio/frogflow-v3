import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { REPORT_KINDS, REPORT_PERIODS } from "@/core/reports/center";

/** Бухгалтеру открыты: деньги и заказы; рассылки и склад закрыты по роли (availableReports). */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();

const input = z.object({
  kind: z.enum(REPORT_KINDS),
  days: z.union([
    z.literal(REPORT_PERIODS[0]),
    z.literal(REPORT_PERIODS[1]),
    z.literal(REPORT_PERIODS[2]),
  ]),
});

/** Какие отчёты доступны этому входу (по модулям и роли). */
export const reportKindsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { ctx, accountant } = await finance();
  const { availableReports } = await import("@/core/reports/center");
  return availableReports(ctx.tenant.modules, accountant);
});

/** Отчёт за период с сравнением с прошлым таким же. Только чтение. */
export const centerReportFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const { ctx, accountant } = await finance();
    const { availableReports, centerReport } = await import("@/core/reports/center");
    if (!availableReports(ctx.tenant.modules, accountant).includes(data.kind))
      throw new (await import("@/core/i18n/user-error")).UserError(
        "err.auth.moduleOff",
        "Модуль «{module}» не подключён к вашему тарифу.",
        { module: data.kind },
      );
    return centerReport(ctx, data.kind, data.days);
  });
