import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MODULE_KEYS } from "@/core/modules/registry";
import { VERTICAL_KEYS } from "@/core/verticals/registry";

/**
 * Серверные функции панели оператора. Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в operator.server.ts (серверный модуль, не попадает в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();
/** Кто действует — логин оператора из базы; в журнале bot_events. */
const actor = async () =>
  (await (await import("./credentials.server")).operatorCredentialsSource()).username ?? "operator";
const impl = () => import("./operator.server");

const botId = z.string().uuid();
const moduleKey = z.enum(MODULE_KEYS as [string, ...string[]]);
const vertical = z.enum(VERTICAL_KEYS as [string, ...string[]]);

export const operatorLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { appSession } = await import("@/app/auth/session.server");
    const { clientIp, loginLocked, recordLogin, loginDelay } =
      await import("@/app/auth/login-guard.server");
    const { verifyOperator } = await import("./credentials.server");
    const ip = clientIp();
    if (await loginLocked("operator", ip))
      throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
    await loginDelay();
    const ok = await verifyOperator(data.username, data.password);
    await recordLogin("operator", ip, ok, data.username);
    if (!ok) return { ok: false as const };
    const s = await appSession();
    await s.update({ operator: true });
    return { ok: true as const };
  });

export const operatorLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  await s.update({ operator: false });
  return { ok: true };
});

export const operatorCheck = createServerFn({ method: "GET" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  return { authed: (await appSession()).data.operator === true };
});

export const listClientsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).listClients();
});

export const getClientFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const m = await impl();
    const [client, events, webhook] = await Promise.all([
      m.getClient(data.botId),
      m.listEvents(data.botId),
      m.webhookState(data.botId),
    ]);
    return { client, events, webhook };
  });

export const updateClientMetaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        name: z.string().min(1).max(120).optional(),
        vertical: vertical.optional(),
        ownerName: z.string().max(120).nullable().optional(),
        ownerContact: z.string().max(200).nullable().optional(),
        ownerTelegramId: z.number().int().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        pausedMessage: z.string().max(1000).nullable().optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...patch } = data;
    await (
      await impl()
    ).updateClientMeta(
      id,
      patch as Parameters<Awaited<ReturnType<typeof impl>>["updateClientMeta"]>[1],
    );
    return { ok: true };
  });

export const setStatusFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, status: z.enum(["active", "paused", "suspended"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setStatus(data.botId, data.status);
    return { ok: true };
  });

export const setModuleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, key: moduleKey, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setModule(data.botId, data.key as (typeof MODULE_KEYS)[number], data.on);
    return { ok: true };
  });

export const connectTelegramFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        token: z.string().regex(/^\d+:[\w-]{30,}$/, "Не похоже на токен BotFather"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).connectTelegram(data.botId, data.token);
  });

export const setServedByFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, servedBy: z.enum(["v1", "v2"]) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).setServedBy(data.botId, data.servedBy);
  });

export const reinstallWebhookFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).reinstallWebhook(data.botId);
  });

export const setAddressingFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        slug: z
          .string()
          .regex(/^[a-z0-9-]{2,40}$/)
          .nullable(),
        hosts: z.array(z.string().min(3).max(120)).max(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (
      await impl()
    ).setAddressing(
      data.botId,
      data.slug,
      data.hosts.map((h) => h.trim().toLowerCase()),
    );
    return { ok: true };
  });

export const setZernioAccountsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, accountIds: z.array(z.string().min(1).max(80)).max(20) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setZernioAccounts(data.botId, data.accountIds);
    return { ok: true };
  });

export const setAdminCredentialsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        username: z.string().regex(/^[a-z0-9_.-]{3,40}$/, "латиница, цифры, точка, дефис"),
        password: z.string().min(8).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setAdminCredentials(data.botId, data.username, data.password);
    return { ok: true };
  });

export const createClientFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        ownerId: z.string().regex(/^[a-z0-9-]{2,40}$/, "латиница, цифры, дефис"),
        vertical,
        ownerName: z.string().max(120).optional(),
        ownerContact: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const id = await (
      await impl()
    ).createClient({ ...data, vertical: data.vertical as (typeof VERTICAL_KEYS)[number] });
    return { id };
  });

export const archiveClientFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).archiveClient(data.botId);
    return { ok: true };
  });

export const notifyOwnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, text: z.string().min(1).max(4000) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).notifyOwner(data.botId, data.text);
  });

/* ── заявки на модули ─────────────────────────────────────────────── */

export const moduleRequestsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).listModuleRequests();
});

export const pendingRequestCountFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).pendingModuleRequestCount();
});

export const resolveModuleRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), action: z.enum(["enable", "dismiss"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).resolveModuleRequest(data.id, data.action);
  });

/* ── рассылка владельцам ──────────────────────────────────────────── */

export const ownerBroadcastsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).listOwnerBroadcasts();
});

export const broadcastToOwnersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({ botIds: z.array(botId).min(1).max(500), text: z.string().trim().min(1).max(4000) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).broadcastToOwners(data.botIds, data.text);
  });

/* ── учётка оператора ─────────────────────────────────────────────── */

export const operatorCredentialsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("./credentials.server")).operatorCredentialsSource();
});

export const setOperatorCredentialsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        currentPassword: z.string().min(1),
        username: z.string().min(3).max(40),
        password: z.string().min(10).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { verifyOperator, operatorCredentialsSource, setOperatorCredentials } =
      await import("./credentials.server");
    const { username } = await operatorCredentialsSource();
    if (!username || !(await verifyOperator(username, data.currentPassword)))
      throw new Error("Текущий пароль неверный.");
    await setOperatorCredentials(data.username, data.password);
    return { ok: true };
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
    return { requisites, payments, invoices, expiresAt };
  });

export const payoutRequisitesFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return { requisites: await (await import("./billing.server")).getPayoutRequisites() };
});

export const setPayoutRequisitesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ requisites: z.string().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await import("./billing.server")).setPayoutRequisites(data.requisites);
    return { ok: true };
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
        action: z.enum(["confirm", "reject", "cancel"]),
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
