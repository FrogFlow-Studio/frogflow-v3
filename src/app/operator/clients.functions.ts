import { SHOP_SLUG_RE } from "@/core/tenant/slug";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MODULE_KEYS } from "@/core/modules/registry";
import { VERTICAL_KEYS } from "@/core/verticals/registry";

/**
 * Серверные функции панели оператора: клиенты: карточка, статус, модули, каналы, создание и связка магазинов.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
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

/** Последние входящие Instagram/WhatsApp клиента с итогом обработки. */
export const clientZernioInboxFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./zernio-inbox.server")).clientZernioInbox(data.botId);
  });

/** Строки базы знаний консультанта по всем клиентам — откуда перенести статьи. */
export const clientKnowledgeSourcesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./knowledge-import.server")).listKnowledgeSources(data.botId);
  });

/** Перенести статьи выбранной строки в базу знаний этого клиента (источник не меняется). */
export const importClientKnowledgeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, sourceBotId: botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await import("./knowledge-import.server")).importKnowledgeFrom(
      data.botId,
      data.sourceBotId,
      await actor(),
    );
  });

/** События, дошедшие до v2 без клиента (аккаунт не привязан или клиент на v1). */
export const unmatchedZernioFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await import("./zernio-inbox.server")).unmatchedZernioEvents();
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

/**
 * Токен VIP-бота из карточки клиента: до переезда тоже — его требует проверка
 * перед переездом, а в админку продавца v1-клиента не пускают. Вебхук VIP
 * ставится только клиенту на v2 (ensureVipWebhook), у v1 его не забираем.
 */
export const connectVipBotOperatorFn = createServerFn({ method: "POST" })
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
    return (await impl()).connectVipBot(data.botId, data.token);
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

/** Отключить аккаунт Instagram/WhatsApp клиента (то же, что кнопка в его админке). */
export const disconnectZernioAccountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, accountId: z.string().trim().min(1).max(100) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    const { disconnectAccount } = await import("@/channels/zernio/connect.server");
    const { requireTenant } = await import("@/core/tenant/resolve.server");
    const tenant = await requireTenant({ by: "id", value: data.botId });
    const r = await disconnectAccount(tenant, data.accountId);
    await (
      await impl()
    ).logEvent(data.botId, "meta", {
      zernio_account_disconnected: data.accountId,
      zernio_in_zernio: r.inZernio,
    });
    return r;
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
