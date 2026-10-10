import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BILLING_ADDONS } from "@/core/tenant/types";
import { TIER_TITLES, TRIAL_TIER } from "@/core/plans/registry";

/**
 * Серверные функции панели оператора: тариф клиента, выручка, реквизиты, комиссия и ИИ-баланс.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const aiImpl = () => import("./ai-balance.server");

const botId = z.string().uuid();

/* ── тариф клиента (core/plans) ─────────────────────────────────── */

const plans = () => import("./plans.server");

/** Выручка платформы: MRR, пробные, просроченные, поступления по месяцам. */
export const revenueFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("./revenue.server")).revenueReport();
});

const addonKey = z.enum(BILLING_ADDONS);

const quota = z.number().int().min(0).max(1_000_000).nullable().optional();

export const planFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await plans()).getPlanView(data.botId);
  });

export const setPlanFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        tier: z.enum(["basic", "pro", "business", "custom"]),
        period: z.enum(["month", "year"]),
        addons: z.array(addonKey).max(2),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...input } = data;
    await (await plans()).setPlan(id, input, await actor());
    return { ok: true };
  });

export const planActionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, action: z.enum(["adopt", "trial"]) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const p = await plans();
    if (data.action === "adopt") {
      await p.adoptSuggestedPlan(data.botId, await actor());
      return { message: "Клиент переведён на план, купленные модули сохранены бесплатно." };
    }
    const r = await p.startTrial(data.botId, await actor());
    return {
      message: `Пробный период ${TIER_TITLES[TRIAL_TIER]} до ${new Date(r.until).toLocaleDateString("ru")}.`,
    };
  });

export const extendTrialFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, days: z.number().int().min(1).max(30) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const r = await (await plans()).extendTrial(data.botId, data.days, await actor());
    return {
      message: `Пробный период продлён до ${new Date(r.until).toLocaleDateString("ru")}.`,
    };
  });

export const setAiQuotaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, ai_dialogs: quota, receipt_checks: quota }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...q } = data;
    await (await plans()).setAiQuota(id, q, await actor());
    return { ok: true };
  });

export const setContractTermsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        monthly_price: z.number().int().min(1).max(10_000_000).nullable(),
        waive_connection: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...input } = data;
    await (await plans()).setContractTerms(id, input, await actor());
    return { ok: true };
  });

const addonPrices = z
  .object({ whatsapp: z.number().min(0).optional(), instagram: z.number().min(0).optional() })
  .default({});

export const planInvoicePreviewFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, period: z.enum(["month", "year"]), addonPrices }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { tenantDirectory } = await import("@/core/tenant/resolve.server");
    const t = (await tenantDirectory(true)).find((x) => x.id === data.botId);
    if (!t) throw new Error("Клиент не найден");
    return (await plans()).planInvoiceQuote(t, data.addonPrices, data.period);
  });

export const createPlanInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, period: z.enum(["month", "year"]), addonPrices }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...input } = data;
    return (await plans()).createPlanInvoice(id, input, await actor());
  });

export const payoutRequisitesFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { payoutRecipient } = await import("@/core/billing/invoice-check.server");
  const b = await import("./billing.server");
  const [requisites, recipient, kaspiLink] = await Promise.all([
    b.getPayoutRequisites(),
    payoutRecipient(),
    b.getKaspiPayLink(),
  ]);
  return { requisites, recipient, kaspiLink };
});

export const setPayoutRequisitesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        requisites: z.string().max(2000),
        recipient: z.string().max(500),
        kaspiLink: z.string().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const b = await import("./billing.server");
    await b.setKaspiPayLink(data.kaspiLink);
    await b.setPayoutRequisites(data.requisites);
    await b.setPayoutRecipient(data.recipient);
    return { ok: true };
  });

/* ── комиссия платформы (core/commission) ─────────────────────────── */

const commissionImpl = () => import("./commission.server");

/** Общий выключатель комиссии: по умолчанию выключен. */
export const commissionSwitchFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await commissionImpl()).commissionSwitchView();
});

export const setCommissionSwitchFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await commissionImpl()).switchCommission(data.enabled);
  });

/** Дата начала комиссии клиента (`ГГГГ-ММ-ДД`); null — общая дата. */
export const setCommissionStartFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((v) => !Number.isNaN(Date.parse(v)), "Нет такой даты")
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await commissionImpl()).setCommissionStart(data.botId, data.start, await actor());
  });

/* ── ИИ-баланс клиента (core/ai/balance) ─────────────────────────── */

/** Ручная поправка баланса: + начислить, − снять; с записью в журнал баланса. */
export const adjustAiBalanceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        usd: z
          .number()
          .min(-1000)
          .max(1000)
          .refine((v) => v !== 0),
        note: z.string().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await aiImpl()).adjustAiBalance(data.botId, data.usd, data.note, await actor());
  });

export const aiMarkupFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return { percent: await (await aiImpl()).getAiMarkup() };
});

/** Наценка на цену API для всех клиентов, %. */
export const setAiMarkupFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ percent: z.number().min(0).max(500) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await aiImpl()).setAiMarkup(data.percent);
    return { ok: true };
  });
