import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CONSULTANT_LIMIT_MAX } from "@/core/consultant/budget";
import { SMART_SEARCH_USD_MAX } from "@/core/search/smart-pure";
import { MODULE_KEYS } from "@/core/modules/registry";
import { VERTICAL_KEYS } from "@/core/verticals/registry";
import { isOutreachChannel, type OutreachChannel } from "@/core/leads/draft";
import { LEAD_STAGES, cleanLeadInput } from "@/core/leads/leads";

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
const aiImpl = () => import("./ai-balance.server");

const botId = z.string().uuid();
const moduleKey = z.enum(MODULE_KEYS as [string, ...string[]]);
const vertical = z.enum(VERTICAL_KEYS as [string, ...string[]]);

export const operatorLogin = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
        code: z.string().max(40).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { appSession } = await import("@/app/auth/session.server");
    const { clientIp, loginLocked, recordLogin, loginDelay } =
      await import("@/app/auth/login-guard.server");
    const { verifyOperator, operatorStamp } = await import("./credentials.server");
    const ip = clientIp();
    if (await loginLocked("operator", ip))
      throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
    await loginDelay();
    const ok = await verifyOperator(data.username, data.password);
    if (!ok) {
      await recordLogin("operator", ip, false, data.username);
      return { ok: false as const };
    }
    // Двухшаговый вход: без кода сессии нет. Пустой код — не попытка, а
    // вопрос «нужен ли код»; неверный — неудача, копится в замок входа.
    const { verifySecondFactor } = await import("./two-factor.server");
    if (!(await verifySecondFactor(data.code))) {
      const tried = Boolean(data.code?.trim());
      if (tried) await recordLogin("operator", ip, false, data.username);
      return { ok: false as const, needCode: true as const, badCode: tried };
    }
    await recordLogin("operator", ip, true, data.username);
    const s = await appSession();
    const { operatorSessionMark } = await import("@/app/auth/session-id");
    await s.update({
      operator: true,
      operatorStamp: (await operatorStamp()) ?? undefined,
      ...operatorSessionMark(),
    });
    return { ok: true as const };
  });

export const operatorLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const s = await appSession();
  // Сначала отзыв, потом стирание: скопированная cookie после выхода не работает.
  if (s.data.operatorSid) {
    const { revokeSession } = await import("@/app/auth/revocation.server");
    await revokeSession(s.data.operatorSid, s.data.operatorIat);
  }
  await s.update({
    operator: false,
    operatorStamp: undefined,
    operatorSid: undefined,
    operatorIat: undefined,
  });
  return { ok: true };
});

export const operatorCheck = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await guard();
    return { authed: true };
  } catch {
    return { authed: false };
  }
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
    const { preflight } = await import("./migration.server");
    const [client, events, webhook, migration, consultant, smartSearch] = await Promise.all([
      m.getClient(data.botId),
      m.listEvents(data.botId),
      m.webhookState(data.botId),
      preflight(data.botId).catch((e) => ({
        ready: false,
        checks: [
          {
            key: "error",
            level: "block" as const,
            title: "Проверка не удалась",
            detail: e instanceof Error ? e.message : String(e),
          },
        ],
      })),
      m.consultantBudget(data.botId),
      m.smartSearchBudget(data.botId),
    ]);
    const ai = await (await aiImpl()).aiBalanceView(data.botId);
    return { client, events, webhook, migration, consultant, smartSearch, ai };
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
    await (
      await impl()
    ).setModule(data.botId, data.key as (typeof MODULE_KEYS)[number], data.on, await actor());
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

export const allEventsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        botId: z.string().uuid().nullable().optional(),
        kind: z.string().max(40).nullable().optional(),
        who: z.enum(["shop", "platform"]).nullable().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).listAllEvents({
      botId: data.botId ?? null,
      kind: data.kind ?? null,
      who: data.who ?? null,
    });
  });

export const preflightAllFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await impl()).preflightAll();
});

export const setServedByBulkFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botIds: z.array(botId).min(1).max(50) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).setServedByBulk(data.botIds);
  });

export const cronStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { listCronStatus } = await import("./cron-status.server");
  return listCronStatus();
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
        slug: z.string().regex(SHOP_SLUG_RE).nullable(),
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

/** Профиль Zernio клиента и сверка его аккаунтов — то же, что кнопка в админке продавца. */
export const syncZernioFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const { ensureTenantProfile, syncAccounts } = await import("@/channels/zernio/connect.server");
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const tenant = await requireTenant({ by: "id", value: data.botId });
    const profileId = await ensureTenantProfile(tenant);
    const r = await syncAccounts({
      ...tenant,
      settings: {
        ...tenant.settings,
        zernio: { ...tenant.settings.zernio, profile_id: profileId },
      },
    });
    await (
      await impl()
    ).logEvent(data.botId, "meta", {
      zernio_profile_id: profileId,
      zernio_account_ids: r.accountIds,
      zernio_conflicts: r.conflicts.map((c) => c.id),
    });
    return { profileId, ...r };
  });

/** Профиль Zernio клиента из v1: записать его, а не создавать новый, и сверить аккаунты. */
export const adoptZernioProfileFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        profileId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{6,80}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { adoptTenantProfile } = await import("@/channels/zernio/connect.server");
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const tenant = await requireTenant({ by: "id", value: data.botId });
    const r = await adoptTenantProfile(tenant, data.profileId);
    await (
      await impl()
    ).logEvent(data.botId, "meta", {
      zernio_profile_id: data.profileId,
      zernio_profile_adopted: true,
      zernio_account_ids: r.accountIds,
      zernio_conflicts: r.conflicts.map((c) => c.id),
    });
    return { profileId: data.profileId, ...r };
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
        ownerId: z.string().regex(SHOP_SLUG_RE, "латиница, цифры, точка, дефис, подчёркивание"),
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
  .validator((d: unknown) =>
    z
      .object({
        botId,
        text: z.string().min(1).max(4000),
        template: z.enum(["payment", "checkin", "feature"]).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).notifyOwner(data.botId, data.text, data.template ?? null);
  });

export const ownerMessageDraftFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).ownerMessageDraft(data.botId);
  });

export const ownerMessagesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).listOwnerMessages(data.botId);
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
    // Все прежние сессии оператора погасли вместе со старым паролем; эта остаётся.
    const { appSession } = await import("@/app/auth/session.server");
    const { operatorStamp } = await import("./credentials.server");
    await (await appSession()).update({ operatorStamp: (await operatorStamp()) ?? undefined });
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

/* ── тариф клиента (core/plans) ─────────────────────────────────── */

const plans = () => import("./plans.server");

/** Выручка платформы: MRR, пробные, просроченные, поступления по месяцам. */
export const revenueFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("./revenue.server")).revenueReport();
});
const addonKey = z.enum(["whatsapp", "instagram"]);
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
      message: `Пробный период Basic до ${new Date(r.until).toLocaleDateString("ru")}.`,
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
    return (await plans()).planInvoicePreview(t, data.addonPrices, data.period);
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

/* ── уведомления оператору о сбоях ботов (health-alerts.server.ts) ── */

const alerts = () => import("./health-alerts.server");

export const alertChannelStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await alerts()).alertChannelStatus();
});

export const saveAlertChannelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ token: z.string().max(200), chatId: z.string().max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await alerts()).saveAlertChannel(data);
    return { ok: true };
  });

export const clearAlertChannelFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  await (await alerts()).clearAlertChannel();
  return { ok: true };
});

export const testAlertChannelFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await alerts()).testAlertChannel();
});

/** Вебхук v2 в Zernio: состояние (только чтение) и привязка к профилям клиентов на v2. */
export const v2WebhookStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("@/channels/zernio/connect.server")).v2WebhookStatus();
});

export const syncV2WebhookFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await import("@/channels/zernio/connect.server")).syncV2Webhook();
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

export const healthHistoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ botId: z.string().uuid(), days: z.number().int().min(1).max(60).optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./health.server")).getHealthHistory(data.botId, data.days ?? 14);
  });

export const recordHealthNowFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./health.server")).recordHealthSnapshots(data.botId);
  });

/** Дневной предел ИИ-консультанта клиенту с большим потоком; null — общий предел. */
export const setConsultantLimitsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const n = (max: number, int: boolean) =>
      (int ? z.number().int() : z.number()).min(0).max(max).nullable();
    return z
      .object({
        botId,
        limits: z
          .object({
            dailyUsd: n(CONSULTANT_LIMIT_MAX.dailyUsd, false),
            dailyCalls: n(CONSULTANT_LIMIT_MAX.dailyCalls, true),
            dailyTests: n(CONSULTANT_LIMIT_MAX.dailyTests, true),
          })
          .nullable(),
      })
      .parse(d);
  })
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantLimits(data.botId, data.limits, await actor());
    return { ok: true };
  });

/** Консультант ищет по каталогу инструментом — для больших каталогов. */
export const setConsultantSearchFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantSearch(data.botId, data.on, await actor());
    return { ok: true };
  });

/** Консультант «по прайсу» (BOVI): прайс 1С, рубли по курсу банка, нерабочие часы. */
export const setConsultantPricelistFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, on: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setConsultantPricelist(data.botId, data.on, await actor());
    return { ok: true };
  });

export const setConsultantPricelistOptionsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        hours: z
          .object({ open: z.number().int().min(0).max(24), close: z.number().int().min(0).max(24) })
          .nullable(),
        rateSource: z.enum(["vtb", "finkaz", "manual"]),
        rateUrl: z.string().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { botId: id, ...options } = data;
    await (await impl()).setConsultantPricelistOptions(id, options, await actor());
    return { ok: true };
  });

/** Дневной предел умного поиска клиента в долларах; null — общий предел. */
export const setSmartSearchLimitFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, dailyUsd: z.number().min(0).max(SMART_SEARCH_USD_MAX).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).setSmartSearchLimit(data.botId, data.dailyUsd, await actor());
    return { ok: true };
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

/** Пробная ошибка в Sentry — проверить, что SENTRY_DSN рабочий. */
export const sendTestErrorFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  const { sendTestError } = await import("@/lib/errors");
  return sendTestError();
});

/* ── аудит чеков (только чтение, лимит клиента не тратится) ───────── */

export const receiptAuditInventoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./receipt-audit.server")).receiptAuditInventory(data.botId);
  });

/** Один шаг прогона: следующий чек с новых к старым; Vision — с ключа платформы. */
export const receiptAuditScanFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        botId,
        afterId: z.number().int().min(0),
        seenHashes: z
          .array(
            z.object({
              hash: z.string().max(128),
              orderId: z.number().int(),
              displayNo: z.union([z.number(), z.string().max(32)]),
            }),
          )
          .max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./receipt-audit.server")).scanNextReceipt(data.botId, {
      afterId: data.afterId,
      seenHashes: data.seenHashes,
    });
  });

/* ── «Несколько ботов»: связать магазины одного продавца ─────────── */

export const shopGroupFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await impl()).shopGroupView(data.botId);
  });

export const linkShopsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, otherId: botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).linkShops(data.botId, data.otherId, await actor());
    return { ok: true };
  });

export const unlinkShopFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await impl()).unlinkShop(data.botId, await actor());
    return { ok: true };
  });

/* ── двухшаговый вход оператора (two-factor.server.ts) ────────────── */

const twoFactor = () => import("./two-factor.server");
/** Включение и выключение меняют отпечаток: прочие сессии гаснут, эта остаётся. */
const keepThisSession = async () => {
  const { appSession } = await import("@/app/auth/session.server");
  const { operatorStamp } = await import("./credentials.server");
  await (await appSession()).update({ operatorStamp: (await operatorStamp()) ?? undefined });
};
const otpCode = z.string().trim().min(6).max(40);

export const twoFactorStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await twoFactor()).twoFactorStatus();
});

export const startTwoFactorFn = createServerFn({ method: "POST" }).handler(async () => {
  await guard();
  return (await twoFactor()).startTwoFactorSetup(await actor());
});

export const confirmTwoFactorFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: otpCode }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    const codes = await (await twoFactor()).confirmTwoFactorSetup(data.code);
    await keepThisSession();
    return { backupCodes: codes };
  });

/**
 * Действие по коду второго шага из настроек: неверный код — такая же
 * неудача входа, как на странице входа, и копится в общий замок.
 */
async function withSecondFactor<T>(run: () => Promise<T>): Promise<T> {
  const { clientIp, loginLocked, recordLogin } = await import("@/app/auth/login-guard.server");
  const ip = clientIp();
  if (await loginLocked("operator", ip))
    throw new Error("Слишком много неудачных попыток. Попробуйте через 15 минут.");
  try {
    return await run();
  } catch (e) {
    if (e instanceof (await twoFactor()).BadSecondFactor)
      await recordLogin("operator", ip, false, await actor());
    throw e;
  }
}

export const disableTwoFactorFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: otpCode }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await withSecondFactor(async () => (await twoFactor()).disableTwoFactor(data.code));
    await keepThisSession();
    return { ok: true };
  });

export const regenerateBackupCodesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: otpCode }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return {
      backupCodes: await withSecondFactor(async () =>
        (await twoFactor()).regenerateBackupCodes(data.code),
      ),
    };
  });

/** Партнёрская программа агентств (core/partners): партнёры, их клиенты и комиссия. */
export const partnersFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { env } = await import("@/config/env");
  const { tenantDirectory } = await import("@/core/tenant/resolve.server");
  const { isInternalTenant } = await import("@/core/tenant/internal");
  const partners = await (await import("./partners.server")).partnersOverview(env().APP_URL);
  const clients = (await tenantDirectory(true))
    .filter((t) => !t.archived && !isInternalTenant(t.id))
    .map((t) => ({ botId: t.id, name: t.name, partner: t.settings.partner ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { partners, clients, signupUrl: `${env().APP_URL}/signup?partner=` };
});

export const savePartnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(30),
        name: z.string().max(120),
        contact: z.string().max(200),
        percent: z.number().min(0).max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./partners.server")).savePartner(data);
  });

export const deletePartnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: z.string().max(30) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await import("./partners.server")).deletePartner(data.code);
    return { ok: true };
  });

export const setClientPartnerFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, code: z.string().max(30).nullable() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await import("./partners.server")).setClientPartner(data.botId, data.code);
    const { logEvent } = await import("./operator.server");
    await logEvent(data.botId, "meta", { action: "partner", partner: data.code }, await actor());
    return { ok: true };
  });

/** Воронка лидов отдела продаж FrogFlow (core/leads): список, добавление, стадия, заметки, журнал. */
const leadsImpl = () => import("./leads.server");
const pipelineImpl = () => import("./leads-pipeline.server");
const leadId = z.string().uuid();
const leadStage = z.enum(LEAD_STAGES);

export const leadsFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const impl = await leadsImpl();
  return { leads: await impl.listLeads(), aiAvailable: impl.leadsAiAvailable() };
});

export const addLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        businessName: z.string().max(200),
        niche: z.string().max(200),
        city: z.string().max(200),
        websiteUrl: z.string().max(400),
        instagramHandle: z.string().max(300),
        phone: z.string().max(60),
        email: z.string().max(200),
        signals: z.string().max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const input = cleanLeadInput(data);
    if (!input)
      throw new Error(
        "Нужны название и хотя бы один контакт: Instagram, телефон, почта или сайт (в правильном виде)",
      );
    return (await leadsImpl()).addLead(input, await actor());
  });

export const setLeadStageFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: leadId,
        from: z.string().max(40),
        to: leadStage,
        lostReason: z.string().max(300).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).setLeadStage(data, await actor());
  });

export const saveLeadNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: leadId,
        notes: z.string().max(4000).nullable(),
        nextAction: z.string().max(300).nullable(),
        nextActionAt: z.string().datetime().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return { saved: await (await leadsImpl()).saveLeadNote(data) };
  });

export const leadEventsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return { events: await (await leadsImpl()).listLeadEvents(data.id) };
  });

export const leadPipelineFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await pipelineImpl()).getPipelineConfig();
});

export const saveLeadPipelineFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        followUpDays: z.number().int().min(1).max(30),
        lostDays: z.number().int().min(3).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await pipelineImpl()).savePipelineConfig(data);
  });

export const scoreLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).scoreLead(data.id, await actor());
  });

/** Импорт лидов из CSV: ничего не отправляется, дубли отсекаются (leads.server importLeads). */
export const importLeadsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ csv: z.string().max(400_000) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).importLeads(data.csv, await actor());
  });

export const huntLeadsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ niche: z.string().max(200), city: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await import("./hunt.server")).huntLeads(data, await actor());
  });

export const draftLeadFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: leadId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).draftLead(data.id, await actor());
  });

export const saveLeadDraftFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: leadId, draft: z.string().max(2000).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return { saved: await (await leadsImpl()).saveLeadDraft(data) };
  });

export const markLeadContactedFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: leadId,
        channel: z
          .string()
          .refine(isOutreachChannel)
          .transform((c) => c as OutreachChannel),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    return (await leadsImpl()).markLeadContacted(data, await actor());
  });
