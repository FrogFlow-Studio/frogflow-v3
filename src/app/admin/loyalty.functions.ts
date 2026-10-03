import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";
import { ADJUST_REASON_MAX, ADJUST_REASON_MIN, MAX_POINTS_ADJUST } from "@/core/loyalty/adjust";

/**
 * Ручная правка баллов покупателя (модуль loyalty, менеджер и владелец).
 * Запись в журнал действий — прослойка админки (core/audit/admin-audit): имя
 * функции, покупатель, дельта и причина.
 */
export const adjustPointsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.string().min(1).max(200),
        delta: z
          .number()
          .int()
          .refine((n) => n !== 0 && Math.abs(n) <= MAX_POINTS_ADJUST),
        reason: z.string().trim().min(ADJUST_REASON_MIN).max(ADJUST_REASON_MAX),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("loyalty", "manager");
    const { adjustCustomerPoints } = await import("@/core/loyalty/adjust");
    const r = await adjustCustomerPoints(ctx, data.key, data.delta, data.reason);
    if (r.ok) return { before: r.before, after: r.after };
    if (r.reason === "not_found")
      throw new UserError("err.customer.notFound", "Покупатель не найден.");
    if (r.reason === "negative")
      throw new UserError(
        "err.loyalty.negative",
        "Нельзя списать больше баллов, чем есть: на балансе {points}.",
        { points: r.points },
      );
    throw new UserError(
      "err.loyalty.busy",
      "Баланс менялся одновременно с вашей правкой. Обновите страницу и повторите.",
    );
  });
