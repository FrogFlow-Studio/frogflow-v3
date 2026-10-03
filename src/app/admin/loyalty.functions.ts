import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";
import { LOYALTY_TIERS_KEY, loyaltyTiers, validateTiers } from "@/core/loyalty/tiers";
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

/** Отчёт «Рефералы» в «Скидках»: имена покупателей — роль не ниже менеджера, как у выгрузки покупателей. */
export const referralReportFn = createServerFn({ method: "GET" }).handler(async () => {
  const { CONTACTS_MIN_ROLE } = await import("@/core/export/export");
  const ctx = await (
    await import("@/app/auth/guards.server")
  ).requireAdminModule("referral", CONTACTS_MIN_ROLE);
  return (await import("@/core/referrals/report")).referralReport(ctx);
});

/** Уровни лояльности для карточки в «Скидках» (модуль loyalty, чтение — любой админ магазина). */
export const loyaltyTiersFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdminModule("loyalty");
  return loyaltyTiers(ctx);
});

/** Сохранить уровни (владелец, как и остальные настройки лояльности): до 4, суммы «от» разные. */
export const saveLoyaltyTiersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        tiers: z.array(
          z.object({ name: z.string().max(80), from: z.number(), percent: z.number() }),
        ),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("loyalty", "owner");
    const tiers = validateTiers(data.tiers);
    const { setSetting } = await import("@/core/settings/settings");
    await setSetting(ctx, LOYALTY_TIERS_KEY, tiers.length ? JSON.stringify(tiers) : "");
    return { tiers };
  });
