import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: подписка и счета клиента, оплаты и просрочка.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";

const botId = z.string().uuid();

export const renewalsOverviewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ days: z.number().int().min(1).max(60) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { renewalsOverview } = await import("./renewals.server");
    return renewalsOverview(data.days);
  });

/* ── подписка и счета ─────────────────────────────────────────────── */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");

export const billingFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const b = await import("./billing.server");
    const [requisites, payments, invoices, expiresAt] = await Promise.all([
      b.getPayoutRequisites(),
      b.listPayments(data.botId),
      b.listInvoices(data.botId),
      b.subscriptionExpiresAt(data.botId),
    ]);
    const suggested = await (await import("./plans.server")).suggestedPeriod(data.botId);
    const { expiryBackedByPayments } = await import("@/core/billing/subscription");
    const backedByPayments = expiryBackedByPayments(expiresAt, payments.length);
    const uncreditedTopups = await (
      await import("./ai-topup.server")
    ).uncreditedAiTopups(
      data.botId,
      invoices.filter((i) => i.status === "paid").map((i) => i.id),
    );
    return {
      requisites,
      payments,
      invoices,
      expiresAt,
      backedByPayments,
      suggested,
      uncreditedTopups,
    };
  });

/** Мастер подключения канала у клиента: на каком шаге застрял и из-за чего (только чтение). */
export const wizardViewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const { wizardOperatorRows } = await import("@/channels/zernio/wizard.server");
    return {
      rows: wizardOperatorRows({ tenant: await requireTenant({ by: "id", value: data.botId }) }),
    };
  });

/** Приглашения авторов (core/invites): кто кого пригласил и можно ли зачесть месяц. */
export const inviteViewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./invites.server")).inviteView(data.botId);
  });

/** Зачесть месяц пригласившему: одна кнопка, один раз (отметка по settings.rev до платежа). */
export const creditInviteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./invites.server")).creditInvite(data.botId, await actor());
  });

export const addPaymentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        period_start: isoDate,
        period_end: isoDate,
        amount: z.number().nonnegative(),
        currency: z.string().trim().min(1).max(8),
        note: z.string().max(500).nullable(),
      })
      .refine((v) => v.period_end >= v.period_start, { message: "Конец периода раньше начала" })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId, ...p } = data;
    return (await import("./billing.server")).addPayment(botId, p, await actor());
  });

export const deletePaymentFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId: z.string().uuid(), paymentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (
      await import("./billing.server")
    ).deletePayment(data.botId, data.paymentId, await actor());
    return { ok: true };
  });

export const createInvoiceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        amount: z.number().positive(),
        currency: z.string().trim().min(1).max(8),
        note: z.string().max(500).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId, ...p } = data;
    return (await import("./billing.server")).createInvoice(botId, p, await actor());
  });

export const invoiceActionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["confirm", "reject", "cancel", "recredit"]),
        periodStart: isoDate.optional(),
        periodEnd: isoDate.optional(),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const b = await import("./billing.server");
    const who = await actor();
    if (data.action === "confirm") {
      if (!data.periodStart || !data.periodEnd) throw new Error("Укажите период подписки");
      const r = await b.confirmInvoice(
        data.id,
        { start: data.periodStart, end: data.periodEnd },
        who,
      );
      return {
        ok: true,
        message: `Счёт оплачен, подписка до ${r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("ru") : "—"}.`,
      };
    }
    if (data.action === "recredit") {
      const after = await (await import("./ai-topup.server")).recreditAiTopup(data.id, who);
      return { ok: true, message: `Зачислено. ИИ-баланс клиента: ${after.usd.toFixed(2)} $.` };
    }
    if (data.action === "reject") {
      await b.rejectInvoice(data.id, data.reason ?? "", who);
      return { ok: true, message: "Счёт отклонён." };
    }
    await b.cancelInvoice(data.id, who);
    return { ok: true, message: "Счёт отменён." };
  });

export const invoiceProofUrlFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return { url: await (await import("./billing.server")).invoiceProofUrl(data.id) };
  });

export const setOverduePolicyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        on_overdue: z.enum(["warn", "suspend"]),
        warn_days_before: z.number().int().min(0).max(60),
        grace_days: z.number().int().min(0).max(60),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId, ...policy } = data;
    await (await import("./billing.server")).setOverduePolicy(botId, policy, await actor());
    return { ok: true };
  });

export const sweepSubscriptionsFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await import("./billing.server")).sweepSubscriptions();
});
