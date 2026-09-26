import { env } from "@/config/env";
import {
  computeState,
  readPolicy,
  type OverduePolicy,
  type SubscriptionState,
} from "@/core/billing/subscription";
import { serviceDb } from "@/core/db/client.server";
import type { Database, Json } from "@/core/db-types";
import { MODULE_KEYS, MODULES, moduleDef, type ModuleKey } from "@/core/modules/registry";
import { VERTICALS, type VerticalKey } from "@/core/verticals/registry";
import { encryptSecret } from "@/core/secrets/vault";
import { telegramApi } from "@/channels/telegram/api";
import {
  invalidateTenantDirectory,
  patchTenantSettings,
  requireTenant,
  tenantContext,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import { ensureTelegramWebhook } from "@/core/tenant/telegram-webhook.server";
import type { Tenant } from "@/core/tenant/types";
import { foreignZernioAccounts } from "@/core/tenant/zernio-accounts";
import { addressConflict } from "@/core/tenant/directory";
import { adminLoginTaken } from "@/core/auth/roles";
import { hashPassword } from "@/app/auth/password";
import { telegramWebhookUrl } from "@/channels/telegram/secret";

type BotUpdate = Database["public"]["Tables"]["bots"]["Update"];
type EventKind =
  | "module_on"
  | "module_off"
  | "pause"
  | "resume"
  | "suspend"
  | "onboard"
  | "webhook"
  | "meta"
  | "message"
  | "payment";

export async function logEvent(
  botId: string,
  kind: EventKind,
  payload: Record<string, unknown> = {},
  actor = "operator",
): Promise<void> {
  const { error } = await serviceDb()
    .from("bot_events")
    .insert({ bot_id: botId, actor, kind, payload: payload as Json });
  if (error) console.warn("[operator] bot_events:", error.message);
}

export type ClientStats = {
  orders_total: number;
  orders_30d: number;
  last_order_at: string | null;
  products_total: number;
  customers_total: number;
  storage_bytes: number;
};

export async function clientStats(): Promise<Map<string, ClientStats>> {
  const { data, error } = await serviceDb().rpc("operator_bot_stats");
  if (error) throw new Error(`operator_bot_stats: ${error.message}`);
  const map = new Map<string, ClientStats>();
  for (const r of data ?? []) {
    map.set(r.bot_id, {
      orders_total: Number(r.orders_total ?? 0),
      orders_30d: Number(r.orders_30d ?? 0),
      last_order_at: r.last_order_at ?? null,
      products_total: Number(r.products_total ?? 0),
      customers_total: Number(r.customers_total ?? 0),
      storage_bytes: Number(r.storage_bytes ?? 0),
    });
  }
  return map;
}

/** Плоское представление клиента для списка и карточки — без секретов. */
export type ClientView = {
  id: string;
  name: string;
  status: Tenant["status"];
  vertical: VerticalKey;
  verticalTitle: string;
  servedBy: "v1" | "v2" | null;
  slug: string | null;
  hosts: string[];
  telegram: { connected: boolean; username: string | null; webhookOk: boolean };
  zernioAccounts: string[];
  zernio: {
    profileId: string | null;
    accounts: Array<{
      id: string;
      platform: string;
      username: string | null;
      name: string | null;
      expired: boolean;
      /** Последнее событие Zernio этого аккаунта в журнале (null — не было). */
      lastEventAt: string | null;
    }>;
    syncedAt: string | null;
    lastEventAt: string | null;
  };
  adminUsername: string | null;
  modules: Record<ModuleKey, boolean>;
  modulesOn: number;
  pausedMessage: string | null;
  appUrl: string | null;
  ownerTelegramId: number | null;
  ownerName: string | null;
  ownerContact: string | null;
  notes: string | null;
  tags: string[];
  subscriptionExpiresAt: string | null;
  /** Состояние подписки из дат и политики (core/billing/subscription). */
  subscription: { state: SubscriptionState; daysLeft: number | null; policy: OverduePolicy };
  /** Последний снимок здоровья (крон health) — null, если снимков ещё нет. */
  health: { ok: boolean; at: string; error: string | null; pending: number | null } | null;
  createdAt: string | null;
  stats: ClientStats | null;
};

function toView(
  t: Tenant,
  extra: {
    owner_name: string | null;
    owner_contact: string | null;
    notes: string | null;
    tags: string[];
    subscription_expires_at: string | null;
    created_at: string | null;
  },
  stats: ClientStats | null,
  health: ClientView["health"] = null,
  zernioEvents: Map<string, string> = new Map(),
): ClientView {
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    vertical: t.vertical,
    verticalTitle: VERTICALS[t.vertical].title,
    servedBy: t.settings.served_by ?? null,
    slug: t.settings.slug ?? null,
    hosts: t.settings.hosts ?? [],
    telegram: {
      connected: Boolean(t.telegramTokenEnc),
      username: t.settings.telegram?.username ?? null,
      webhookOk: Boolean(t.settings.telegram?.webhook_ok),
    },
    zernioAccounts: t.settings.zernio?.account_ids ?? [],
    zernio: {
      profileId: t.settings.zernio?.profile_id ?? null,
      accounts: (t.settings.zernio?.accounts ?? []).map((a) => ({
        id: a.id,
        platform: a.platform,
        username: a.username ?? null,
        name: a.name ?? null,
        expired: Boolean(a.expired),
        lastEventAt: zernioEvents.get(a.id) ?? null,
      })),
      syncedAt: t.settings.zernio?.synced_at ?? null,
      lastEventAt: zernioEvents.get("*") ?? null,
    },
    adminUsername: t.settings.admin?.username ?? null,
    modules: t.modules,
    modulesOn: MODULE_KEYS.filter((k) => t.modules[k]).length,
    pausedMessage: t.pausedMessage,
    appUrl: t.appUrl,
    ownerTelegramId: t.ownerTelegramId,
    ownerName: extra.owner_name,
    ownerContact: extra.owner_contact,
    notes: extra.notes,
    tags: extra.tags,
    subscriptionExpiresAt: extra.subscription_expires_at,
    subscription: (() => {
      const st = computeState(extra.subscription_expires_at, readPolicy(t.settings));
      return { state: st.state, daysLeft: st.daysLeft, policy: st.policy };
    })(),
    createdAt: extra.created_at,
    stats,
    health,
  };
}

async function extras(ids?: string[]) {
  let q = serviceDb()
    .from("bots")
    .select("id, owner_name, owner_contact, notes, tags, subscription_expires_at, created_at");
  if (ids) q = q.in("id", ids);
  const { data } = await q;
  return new Map((data ?? []).map((r) => [r.id, r]));
}

export async function listClients(): Promise<ClientView[]> {
  const { latestHealth } = await import("./health.server");
  const [tenants, stats, ex, health] = await Promise.all([
    tenantDirectory(true),
    clientStats().catch(() => new Map<string, ClientStats>()),
    extras(),
    latestHealth().catch(() => new Map()),
  ]);
  return tenants
    .map((t) => {
      const e = ex.get(t.id);
      return toView(
        t,
        {
          owner_name: e?.owner_name ?? null,
          owner_contact: e?.owner_contact ?? null,
          notes: e?.notes ?? null,
          tags: e?.tags ?? [],
          subscription_expires_at: e?.subscription_expires_at ?? null,
          created_at: e?.created_at ?? null,
        },
        stats.get(t.id) ?? null,
        health.get(t.id) ?? null,
      );
    })
    .sort(
      (a, b) =>
        (b.stats?.orders_30d ?? 0) - (a.stats?.orders_30d ?? 0) ||
        a.name.localeCompare(b.name, "ru"),
    );
}

export async function getClient(botId: string): Promise<ClientView> {
  const { latestHealth } = await import("./health.server");
  const health = await latestHealth([botId]).catch(() => new Map());
  const [t, stats, ex, zernioEvents] = await Promise.all([
    requireTenant({ by: "id", value: botId }),
    clientStats().catch(() => new Map<string, ClientStats>()),
    extras([botId]),
    zernioLastEvents(botId).catch(() => new Map<string, string>()),
  ]);
  const e = ex.get(botId);
  return toView(
    t,
    {
      owner_name: e?.owner_name ?? null,
      owner_contact: e?.owner_contact ?? null,
      notes: e?.notes ?? null,
      tags: e?.tags ?? [],
      subscription_expires_at: e?.subscription_expires_at ?? null,
      created_at: e?.created_at ?? null,
    },
    stats.get(botId) ?? null,
    health.get(botId) ?? null,
    zernioEvents,
  );
}

/**
 * Когда аккаунт последний раз присылал событие: по журналу zernio_logs,
 * ключ — accountId из payload, «*» — любое событие клиента. Оператор по
 * этому видит, что вебхук доходит именно до этого клиента.
 */
export async function zernioLastEvents(botId: string, limit = 300): Promise<Map<string, string>> {
  const { data } = await serviceDb()
    .from("zernio_logs")
    .select("payload, created_at")
    .eq("bot_id", botId)
    .neq("status", "event")
    .neq("event_type", "telegram.update")
    .order("created_at", { ascending: false })
    .limit(limit);
  const out = new Map<string, string>();
  for (const row of data ?? []) {
    if (!out.has("*")) out.set("*", row.created_at);
    const p = row.payload as { account?: { accountId?: string; id?: string; _id?: string } } | null;
    const id = p?.account?.accountId || p?.account?.id || p?.account?._id;
    if (id && !out.has(id)) out.set(id, row.created_at);
  }
  return out;
}

export type EventView = { id: string; at: string; actor: string; kind: string; payload: Json };

export async function listEvents(botId: string, limit = 40): Promise<EventView[]> {
  const { data } = await serviceDb()
    .from("bot_events")
    .select("id, at, actor, kind, payload")
    .eq("bot_id", botId)
    .order("at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export type PlatformEvent = EventView & { botId: string; botName: string };

/** Журнал действий оператора по всем клиентам: кто, что, у кого. */
export async function listAllEvents(
  opts: { limit?: number; botId?: string | null; kind?: string | null } = {},
): Promise<PlatformEvent[]> {
  let q = serviceDb()
    .from("bot_events")
    .select("id, at, actor, kind, payload, bot_id")
    .order("at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.botId) q = q.eq("bot_id", opts.botId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  const { data } = await q;
  const names = new Map((await tenantDirectory()).map((t) => [t.id, t.name]));
  return (data ?? []).map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor,
    kind: r.kind,
    payload: r.payload,
    botId: r.bot_id,
    botName: names.get(r.bot_id) ?? r.bot_id.slice(0, 8),
  }));
}

export type MigrationCandidate = {
  id: string;
  name: string;
  servedBy: "v1" | "v2" | null;
  ready: boolean;
  blockers: string[];
  warnings: string[];
};

/** Предполётная проверка всех клиентов, которых ещё обслуживает v1. */
export async function preflightAll(): Promise<MigrationCandidate[]> {
  const { preflight } = await import("./migration.server");
  const { preflightBlockers } = await import("@/core/tenant/preflight");
  const tenants = (await tenantDirectory(true)).filter(
    (t) => !t.archived && t.settings.served_by !== "v2",
  );
  const out: MigrationCandidate[] = [];
  for (const t of tenants) {
    try {
      const p = await preflight(t.id);
      out.push({
        id: t.id,
        name: t.name,
        servedBy: t.settings.served_by ?? null,
        ready: p.ready,
        blockers: preflightBlockers(p),
        warnings: p.checks.filter((c) => c.level === "warn").map((c) => c.title),
      });
    } catch (e) {
      out.push({
        id: t.id,
        name: t.name,
        servedBy: t.settings.served_by ?? null,
        ready: false,
        blockers: [e instanceof Error ? e.message : String(e)],
        warnings: [],
      });
    }
  }
  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name));
}

/** Массовый переезд: каждый клиент проходит ту же проверку, что и одиночный. */
export async function setServedByBulk(
  botIds: string[],
  actor = "operator",
): Promise<Array<{ id: string; ok: boolean; error?: string }>> {
  const out: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of botIds) {
    try {
      await setServedBy(id, "v2", actor);
      out.push({ id, ok: true });
    } catch (e) {
      out.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

export async function updateClientMeta(
  botId: string,
  patch: {
    name?: string;
    vertical?: VerticalKey;
    ownerName?: string | null;
    ownerContact?: string | null;
    ownerTelegramId?: number | null;
    notes?: string | null;
    pausedMessage?: string | null;
    tags?: string[];
  },
) {
  const upd: BotUpdate = {};
  if (patch.name !== undefined) upd.bot_name = patch.name;
  if (patch.vertical !== undefined) upd.vertical = patch.vertical;
  if (patch.ownerName !== undefined) upd.owner_name = patch.ownerName;
  if (patch.ownerContact !== undefined) upd.owner_contact = patch.ownerContact;
  if (patch.ownerTelegramId !== undefined) upd.owner_telegram_id = patch.ownerTelegramId;
  if (patch.notes !== undefined) upd.notes = patch.notes;
  if (patch.pausedMessage !== undefined) upd.paused_message = patch.pausedMessage;
  if (patch.tags !== undefined) upd.tags = patch.tags;
  const { error } = await serviceDb().from("bots").update(upd).eq("id", botId);
  if (error) throw new Error(error.message);
  invalidateTenantDirectory();
  await logEvent(botId, "meta", patch as Record<string, unknown>);
}

export async function setStatus(botId: string, status: Tenant["status"]) {
  const { error } = await serviceDb().from("bots").update({ status }).eq("id", botId);
  if (error) throw new Error(error.message);
  invalidateTenantDirectory();
  await logEvent(botId, status === "active" ? "resume" : status === "paused" ? "pause" : "suspend");
}

export async function setModule(botId: string, key: ModuleKey, on: boolean) {
  const def = moduleDef(key);
  if (on && def.status !== "available")
    throw new Error(`Модуль «${def.title}» ещё не реализован — включить нельзя.`);
  const { data } = await serviceDb().from("bots").select("modules").eq("id", botId).single();
  const cur = (
    data?.modules && typeof data.modules === "object" && !Array.isArray(data.modules)
      ? data.modules
      : {}
  ) as Record<string, boolean>;
  if (on)
    for (const req of def.requires ?? [])
      if (!cur[req]) throw new Error(`Сначала включите «${moduleDef(req as ModuleKey).title}».`);
  if (!on)
    for (const k of MODULE_KEYS)
      if (cur[k] && (MODULES[k] as { requires?: string[] }).requires?.includes(key))
        throw new Error(`Сначала выключите «${moduleDef(k).title}» — он зависит от этого модуля.`);
  const next = { ...cur, [key]: on };
  const { error } = await serviceDb().from("bots").update({ modules: next }).eq("id", botId);
  if (error) throw new Error(error.message);
  invalidateTenantDirectory();
  await logEvent(botId, on ? "module_on" : "module_off", { module: key });
}

export async function connectTelegram(botId: string, token: string, actor = "operator") {
  const e = env();
  const me = await telegramApi(token, e.TELEGRAM_API_BASE).call<{ username?: string; id?: number }>(
    "getMe",
  );
  if (!me.ok) throw new Error(`Telegram отверг токен: ${me.description ?? "getMe failed"}`);
  const { error } = await serviceDb()
    .from("bots")
    .update({ bot_token: encryptSecret(token, e.SECRETS_KEY) })
    .eq("id", botId);
  if (error) throw new Error(error.message);
  await patchTenantSettings(botId, {
    telegram: { username: me.result?.username ?? null, webhook_ok: false },
  });
  await logEvent(botId, "webhook", { action: "token", username: me.result?.username }, actor);
  return { username: me.result?.username ?? null };
}

/** VIP-бот клиента: второй токен → getMe → шифрование в settings.vip → вебхук. */
export async function connectVipBot(botId: string, token: string, actor = "operator") {
  const e = env();
  const me = await telegramApi(token, e.TELEGRAM_API_BASE).call<{ username?: string }>("getMe");
  if (!me.ok) throw new Error(`Telegram отверг токен: ${me.description ?? "getMe failed"}`);
  await patchTenantSettings(botId, {
    vip: {
      token_enc: encryptSecret(token, e.SECRETS_KEY),
      username: me.result?.username ?? null,
      webhook_ok: false,
    },
  });
  await logEvent(botId, "webhook", { action: "vip_token", username: me.result?.username }, actor);
  const { ensureVipWebhook } = await import("@/core/tenant/vip-webhook.server");
  const webhook = await ensureVipWebhook(await requireTenant({ by: "id", value: botId }), true);
  await logEvent(botId, "webhook", { action: "vip_set", ...webhook }, actor);
  return { username: me.result?.username ?? null, webhook };
}

export async function setServedBy(botId: string, servedBy: "v1" | "v2", actor = "operator") {
  if (servedBy === "v2") {
    // Переезд только после предполётной проверки: с непернесённым модулем
    // или без токена клиент остался бы без бота.
    const { preflight } = await import("./migration.server");
    const { preflightBlockers } = await import("@/core/tenant/preflight");
    const p = await preflight(botId);
    if (!p.ready)
      throw new Error(`Клиента нельзя перевести на v2: ${preflightBlockers(p).join("; ")}.`);
  }
  await patchTenantSettings(botId, { served_by: servedBy });
  await logEvent(botId, "webhook", { action: "served_by", value: servedBy }, actor);
  if (servedBy === "v2") {
    await importLegacyStoryTags(botId).catch((e) =>
      console.warn(`[operator] story tags import for ${botId}: ${String(e)}`),
    );
    return reinstallWebhook(botId, actor);
  }
  return null;
}

/**
 * Теги сторис из v1 (`story_product_tags`, bot_id TEXT без RLS — ядро v2 её
 * не читает) один раз копируются в app_settings клиента при переезде.
 */
export async function importLegacyStoryTags(botId: string): Promise<number> {
  const { listStoryTags, saveStoryTags } = await import("@/core/consultant/story-tags");
  const t = await requireTenant({ by: "id", value: botId });
  const ctx = tenantContext(t);
  if ((await listStoryTags(ctx)).length > 0) return 0;
  const { data } = await serviceDb()
    .from("story_product_tags")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as Array<{
    id: string;
    story_id: string;
    story_url: string | null;
    product_id: string | null;
    product_name: string;
    product_price_kzt: number | null;
    notes: string | null;
    created_at: string | null;
  }>;
  if (!rows.length) return 0;
  await saveStoryTags(
    ctx,
    rows.map((r) => ({
      id: r.id,
      story_id: r.story_id,
      story_url: r.story_url,
      product_id: r.product_id,
      product_name: r.product_name,
      price: r.product_price_kzt,
      notes: r.notes,
      created_at: r.created_at ?? new Date().toISOString(),
    })),
  );
  await logEvent(botId, "meta", { story_tags_imported: rows.length });
  return rows.length;
}

export async function reinstallWebhook(botId: string, actor = "operator") {
  const t = await requireTenant({ by: "id", value: botId });
  const r = await ensureTelegramWebhook(t, true);
  await logEvent(botId, "webhook", { action: "set", ...r }, actor);
  return r;
}

export async function webhookState(botId: string): Promise<{
  url: string | null;
  pending: number;
  expected: string;
  ok: boolean;
  error?: string;
} | null> {
  const t = await requireTenant({ by: "id", value: botId });
  if (!t.telegramTokenEnc) return null;
  const expected = telegramWebhookUrl(env().APP_URL, t.id);
  try {
    const api = telegramApi(tenantContext(t).secrets.telegramToken(), env().TELEGRAM_API_BASE);
    const info = await api.call<{ url?: string; pending_update_count?: number }>("getWebhookInfo");
    const url = info.result?.url ?? null;
    return { url, pending: info.result?.pending_update_count ?? 0, expected, ok: url === expected };
  } catch (e) {
    return {
      url: null,
      pending: 0,
      expected,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function setAddressing(botId: string, slug: string | null, hosts: string[]) {
  const taken = addressConflict(await tenantDirectory(true), botId, { slug, hosts });
  if (taken) throw new Error(`Адрес «${taken.what}» уже занят клиентом «${taken.owner}».`);
  await patchTenantSettings(botId, { slug: slug ?? "", hosts });
  await logEvent(botId, "meta", { slug, hosts });
}

export async function setZernioAccounts(botId: string, accountIds: string[]) {
  const foreign = foreignZernioAccounts(await tenantDirectory(true), botId, accountIds);
  if (foreign.length)
    throw new Error(
      `Аккаунт ${foreign.map((f) => `${f.id} уже у клиента «${f.owner.name}»`).join(", ")}. ` +
        "Ключ Zernio один на платформу: у аккаунта может быть только один клиент.",
    );
  await patchTenantSettings(botId, { zernio: { account_ids: accountIds } });
  await logEvent(botId, "meta", { zernio_account_ids: accountIds });
}

export async function setAdminCredentials(botId: string, username: string, password: string) {
  // Логин уникален на всей платформе, включая пользователей команд (core/auth/roles).
  const dir = await tenantDirectory(true);
  const self = dir.find((t) => t.id === botId)?.settings.admin?.username;
  if (adminLoginTaken(dir, username, { botId, username: self }))
    throw new Error(`Логин «${username}» уже используется.`);
  await patchTenantSettings(botId, { admin: { username, password_hash: hashPassword(password) } });
  await logEvent(botId, "meta", { admin_username: username });
}

export async function createClient(input: {
  name: string;
  ownerId: string;
  vertical: VerticalKey;
  ownerName?: string;
  ownerContact?: string;
  admin?: { username: string; password: string };
  actor?: string;
  /** Отпечаток адреса регистрации — по нему считается лимит /signup. */
  ipHash?: string;
}) {
  const { data: dup } = await serviceDb()
    .from("bots")
    .select("id")
    .eq("owner_id", input.ownerId)
    .limit(1)
    .maybeSingle();
  if (dup) throw new Error(`Идентификатор «${input.ownerId}» уже занят.`);
  const dir = await tenantDirectory(true);
  if (input.admin && adminLoginTaken(dir, input.admin.username))
    throw new Error(`Логин «${input.admin.username}» уже используется.`);
  // slug нового клиента = его идентификатор: занятый адрес не отдаём.
  const slugTaken = addressConflict(dir, null, { slug: input.ownerId });
  if (slugTaken) throw new Error(`Адрес «${slugTaken.what}» уже занят — выберите другой логин.`);
  const modules = Object.fromEntries(
    MODULE_KEYS.map((k) => [k, moduleDef(k).price === null && moduleDef(k).status === "available"]),
  );
  const settings: Record<string, unknown> = { served_by: "v2", slug: input.ownerId };
  if (input.admin) {
    settings.admin = {
      username: input.admin.username,
      password_hash: hashPassword(input.admin.password),
    };
  }
  const { data, error } = await serviceDb()
    .from("bots")
    .insert({
      bot_name: input.name,
      owner_id: input.ownerId,
      vertical: input.vertical,
      status: "active",
      modules,
      owner_name: input.ownerName ?? null,
      owner_contact: input.ownerContact ?? null,
      settings: settings as Json,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  invalidateTenantDirectory();
  await logEvent(
    data.id,
    "onboard",
    {
      name: input.name,
      vertical: input.vertical,
      ...(input.ipHash ? { ip_hash: input.ipHash } : {}),
    },
    input.actor ?? "operator",
  );
  return data.id;
}

export async function archiveClient(botId: string) {
  const { error } = await serviceDb()
    .from("bots")
    .update({ archived_at: new Date().toISOString(), status: "suspended" })
    .eq("id", botId);
  if (error) throw new Error(error.message);
  invalidateTenantDirectory();
  await logEvent(botId, "suspend", { archived: true });
}

export async function notifyOwner(
  botId: string,
  text: string,
): Promise<{ delivered: string[]; failed: Array<{ id: string; reason: string }> }> {
  const t = await requireTenant({ by: "id", value: botId });
  const ctx = tenantContext(t);
  const { adminRecipients } = await import("@/core/notify/recipients");
  const api = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const delivered: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of await adminRecipients(ctx)) {
    const r = await api.call("sendMessage", { chat_id: id, text });
    if (r.ok) delivered.push(id);
    else failed.push({ id, reason: r.description ?? "нет ответа" });
  }
  await logEvent(botId, "message", {
    text: text.slice(0, 200),
    delivered: delivered.length,
    failed: failed.length,
  });
  return { delivered, failed };
}

/* ── заявки на модули ─────────────────────────────────────────────── */

export type ModuleRequestView = {
  id: string;
  botId: string;
  clientName: string;
  moduleKey: ModuleKey;
  moduleTitle: string;
  price: number | null;
  requestedAt: string;
  alreadyOn: boolean;
};

/** Единая очередь «Заказать подключение» со всех клиентов, самая старая внизу. */
export async function listModuleRequests(): Promise<ModuleRequestView[]> {
  const { data, error } = await serviceDb()
    .from("module_requests")
    .select("id, bot_id, module_key, requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  if (!data?.length) return [];
  const tenants = await tenantDirectory(true);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  return data
    .filter((r) => byId.has(r.bot_id))
    .map((r) => {
      const t = byId.get(r.bot_id)!;
      const key = r.module_key as ModuleKey;
      const def = MODULES[key];
      return {
        id: r.id,
        botId: r.bot_id,
        clientName: t.name,
        moduleKey: key,
        moduleTitle: def?.title ?? r.module_key,
        price: def?.price ?? null,
        requestedAt: r.requested_at,
        alreadyOn: Boolean(t.modules[key]),
      };
    });
}

export async function pendingModuleRequestCount(): Promise<number> {
  const { count } = await serviceDb()
    .from("module_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/**
 * Закрыть заявку: включить модуль (и сказать владельцу) или просто снять с
 * очереди. Владельца уведомляем лучшим старанием — без бота сообщение не уйдёт.
 */
export async function resolveModuleRequest(
  id: string,
  action: "enable" | "dismiss",
  actor = "operator",
): Promise<{ notified: boolean }> {
  const { data: req } = await serviceDb()
    .from("module_requests")
    .select("id, bot_id, module_key, status")
    .eq("id", id)
    .maybeSingle();
  if (!req) throw new Error("Заявка не найдена.");
  if (req.status !== "pending") return { notified: false };
  const key = req.module_key as ModuleKey;
  let notified = false;
  if (action === "enable") {
    await setModule(req.bot_id, key, true);
    const title = MODULES[key]?.title ?? key;
    notified = await notifyOwner(req.bot_id, `✅ Модуль «${title}» подключён к вашему магазину.`)
      .then((r) => r.delivered.length > 0)
      .catch(() => false);
  }
  // CHECK на status допускает только pending/resolved — «снять» тоже resolved,
  // разница остаётся в журнале клиента.
  const { error: updError } = await serviceDb()
    .from("module_requests")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (updError) throw new Error(`Не удалось закрыть заявку: ${updError.message}`);
  await logEvent(req.bot_id, "meta", { module_request: key, action }, actor);
  return { notified };
}

/* ── рассылка владельцам магазинов ────────────────────────────────── */

export type OwnerDelivery = {
  bot_id: string;
  bot_name: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  at: string;
};

/**
 * Одно сообщение сразу всем (или выбранным) владельцам — через их же ботов.
 * Параллельно: общее время равно самому медленному, а не сумме. Отчёт по
 * каждому клиенту сохраняется в operator_broadcasts, а notifyOwner пишет
 * событие «message» в журнал клиента.
 */
export async function broadcastToOwners(
  botIds: string[],
  text: string,
  actor = "operator",
): Promise<{ id: string; results: OwnerDelivery[] }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Пустое сообщение.");
  const tenants = await tenantDirectory(true);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const now = () => new Date().toISOString();
  const results = await Promise.all(
    botIds.map(async (id): Promise<OwnerDelivery> => {
      const t = byId.get(id);
      if (!t)
        return {
          bot_id: id,
          bot_name: "—",
          status: "skipped",
          error: "Клиент не найден",
          at: now(),
        };
      if (!t.telegramTokenEnc)
        return {
          bot_id: id,
          bot_name: t.name,
          status: "skipped",
          error: "Нет Telegram-бота",
          at: now(),
        };
      try {
        const r = await notifyOwner(id, trimmed);
        if (r.delivered.length > 0)
          return { bot_id: id, bot_name: t.name, status: "sent", at: now() };
        return {
          bot_id: id,
          bot_name: t.name,
          status: "failed",
          error: r.failed[0]?.reason ?? "не настроен id администратора",
          at: now(),
        };
      } catch (e) {
        return {
          bot_id: id,
          bot_name: t.name,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
          at: now(),
        };
      }
    }),
  );
  const { data, error } = await serviceDb()
    .from("operator_broadcasts")
    .insert({
      actor,
      message_text: trimmed,
      target: botIds.length === tenants.filter((t) => !t.archived).length ? "all" : "selected",
      results: results as unknown as Json,
    })
    .select("id")
    .single();
  if (error) console.error("[operator] operator_broadcasts insert:", error.message);
  return { id: data?.id ?? "", results };
}

export type OwnerBroadcastView = {
  id: string;
  created_at: string;
  actor: string;
  message_text: string;
  target: string;
  results: OwnerDelivery[];
};

export async function listOwnerBroadcasts(limit = 20): Promise<OwnerBroadcastView[]> {
  const { data, error } = await serviceDb()
    .from("operator_broadcasts")
    .select("id, created_at, actor, message_text, target, results")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    results: Array.isArray(r.results) ? (r.results as unknown as OwnerDelivery[]) : [],
  }));
}
