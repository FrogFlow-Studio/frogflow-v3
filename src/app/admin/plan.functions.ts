import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import { subscriptionView, trialBanner } from "./admin-shared";

/**
 * Админка продавца: тариф магазина, история оплат и комиссия.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Разделы бухгалтера (guards.server requireAdminFinance): ответ без контактов, если это он. */
const finance = async () => (await import("@/app/auth/guards.server")).requireAdminFinance();

const adminOwner = async () => (await import("@/app/auth/guards.server")).requireAdminRole("owner");

const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

/* ── тариф магазина (core/plans) ─────────────────────────────────── */

export const myPlanFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { parsePlan, nicheForVertical, MONTHLY_PRICE, CONNECTION_PRICE, ADDON_KEYS } =
    await import("@/core/plans/registry");
  const { planUsage, USAGE_KEYS } = await import("@/core/plans/tenant");
  const { getSettings } = await import("@/core/settings/settings");
  const plan = parsePlan(ctx.tenant.plan);
  const values = await getSettings(ctx, Object.values(USAGE_KEYS));
  const { data: pending, error: pendingError } = await ctx.db
    .from("module_requests")
    .select("module_key")
    .eq("status", "pending");
  if (pendingError) throw serverFailure(`Админка: ${pendingError.message}`);
  const billing = ctx.tenant.settings.billing ?? {};
  return {
    plan: plan?.kind === "tier" ? plan.tier : plan?.kind === "custom" ? ("custom" as const) : null,
    hasTiers: Boolean(nicheForVertical(ctx.tenant.vertical)),
    period: billing.period ?? "month",
    trialUntil: billing.trial_until ?? null,
    /** Срок оплаченной подписки: до какого дня и что будет (null — срок не заведён). */
    subscription: (await trialBanner(ctx)) ? null : await subscriptionView(ctx),
    addons: billing.addons ?? [],
    availableAddons: ADDON_KEYS,
    prices: { monthly: MONTHLY_PRICE, connection: CONNECTION_PRICE },
    usage: planUsage(ctx.tenant, values),
    pending: (pending ?? []).map((r) => r.module_key),
  };
});

/** «История оплат» в «Ваш план»: платежи или счета подписки, постранично. Видит и бухгалтер, менеджер — нет. */
export const billingHistoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ kind: z.enum(["payments", "invoices"]), page: z.number().int().min(0).max(10_000) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { ctx } = await finance();
    // Оплата тарифа — владельцу и бухгалтеру; администратор, менеджер и «просмотр» её не видят.
    const role = await (await import("@/app/auth/guards.server")).adminRole();
    if (role === "admin" || role === "manager" || role === "viewer")
      throw new UserError("err.auth.ownerOnly", "Это может изменить только владелец магазина.");
    const { billingHistory } = await import("./billing-history.server");
    return data.kind === "payments"
      ? {
          kind: "payments" as const,
          ...(await billingHistory(ctx.tenant.id, "payments", data.page)),
        }
      : {
          kind: "invoices" as const,
          ...(await billingHistory(ctx.tenant.id, "invoices", data.page)),
        };
  });

/**
 * Страница «Комиссия»: продажи витрины и маркета за этот и прошлый месяц,
 * порог, сумма комиссии и подсказка о тарифе. Только владелец. Месяцы — по
 * поясу магазина; пока общий выключатель платформы выключен, суммы комиссии
 * нули, а подсказки нет.
 */
export const commissionPageFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await adminOwner();
  const { commissionPage } = await import("./commission.server");
  return commissionPage(ctx);
});

export const requestPlanFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.enum([
          "plan:basic",
          "plan:pro",
          "plan:business",
          "addon:whatsapp",
          "addon:instagram",
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminOwner();
    const { error } = await ctx.db
      .from("module_requests")
      .insert({ bot_id: ctx.tenant.id, module_key: data.key });
    if (error && !/duplicate|unique/i.test(error.message)) throw serverFailure(error.message);
    return { ok: true };
  });

/** «Оплатить»: счёт на сумму плана со ссылкой и QR Kaspi Pay (или реквизитами). */
export const payPlanFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminOwner();
  const { ownerPayInvoice } = await import("@/app/operator/plans.server");
  const { qrSvg } = await import("@/core/billing/pay/kaspi-link");
  const r = await ownerPayInvoice(ctx.tenant.id, await actor());
  return { ...r, qr: r.payUrl ? qrSvg(r.payUrl) : null };
});
