import { pageAll } from "@/core/db/page";
import { env } from "@/config/env";
import { signupOriginLabel, type SignupOrigin } from "@/core/signup/origin";
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
import {
  ADDONS,
  ADDON_MONTHLY_PRICE,
  ADDON_KEYS,
  MONTHLY_PRICE,
  PLAN_TIERS,
  TIER_TITLES,
  parsePlan,
  type AddonKey,
  type PlanTier,
} from "@/core/plans/registry";
import { encryptSecret } from "@/core/secrets/vault";
import { telegramApi } from "@/channels/telegram/api";
import {
  invalidateTenantDirectory,
  patchTenantSettings,
  requireTenant,
  tenantContext,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import { ensureTelegramWebhook } from "@/channels/telegram/webhook-setup.server";
import type { Tenant } from "@/core/tenant/types";
import { foreignZernioAccounts } from "@/core/tenant/zernio-accounts";
import { addressConflict, telegramBotTaken, vipBotTaken } from "@/core/tenant/directory";
import { UserError } from "@/core/i18n/user-error";
import { adminLoginTaken } from "@/core/auth/roles";
import type { Pulse } from "./pulse";
import type { Locale } from "@/core/i18n/locale";
import { sellerLocaleSafe } from "@/core/ai/seller-text";
import { ownerTemplates, type OwnerTemplateKey } from "@/core/notify/owner-templates";
import { hashPassword } from "@/app/auth/password";
import { telegramWebhookUrl } from "@/channels/telegram/secret";
import { NO_RECIPIENTS_REASON, type DeliveryReport } from "@/core/notify/deliver";
import { serverFailure } from "@/lib/server-failure";
import { storyTagsNote, type StoryTagsImport } from "./story-tags-import.server";

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
  if (error) throw serverFailure(`[operator] статистика клиентов не прочитана: ${error.message}`);
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
    /** Профиль Zernio из последнего события в журнале (у клиента v1 — профиль деплоя v1). */
    seenProfileId: string | null;
  };
  adminUsername: string | null;
  modules: Record<ModuleKey, boolean>;
  modulesOn: number;
  /** `settings.billing.plan` — ключ плана, `custom` или null (core/plans). */
  plan: string | null;
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
  /** Откуда пришёл продавец, зарегистрировавшийся сам; null — не знаем. */
  signupOrigin: string | null;
  stats: ClientStats | null;
  /** Статистика не прочиталась (сбой базы): показывать «не прочитано», а не нули и не «нет заказов». */
  statsUnread: boolean;
  /** Пульс (заказы 14/14, последний вход) — только у клиентов v2, у остальных null. */
  pulse: Pulse | null;
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
  pulse: Pulse | null = null,
  statsUnread = false,
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
      seenProfileId: zernioEvents.get(PROFILE_KEY) ?? null,
    },
    adminUsername: t.settings.admin?.username ?? null,
    modules: t.modules,
    modulesOn: MODULE_KEYS.filter((k) => t.modules[k]).length,
    plan: t.plan,
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
    signupOrigin: signupOriginLabel(t.settings.signup),
    stats,
    statsUnread,
    health,
    pulse,
  };
}

async function extras(ids?: string[]) {
  let q = serviceDb()
    .from("bots")
    .select("id, owner_name, owner_contact, notes, tags, subscription_expires_at, created_at");
  if (ids) q = q.in("id", ids);
  const { data, error: readErr8 } = await q;
  if (readErr8) throw serverFailure(`[operator] данные клиентов не прочитаны: ${readErr8.message}`);
  return new Map((data ?? []).map((r) => [r.id, r]));
}

/** Статистика клиентов; сбой — пустая карта и отметка, чтобы панель написала «не прочитано». */
async function readStats(): Promise<{ stats: Map<string, ClientStats>; unread: boolean }> {
  try {
    return { stats: await clientStats(), unread: false };
  } catch (e) {
    console.warn("[operator] статистика клиентов не прочитана:", e);
    return { stats: new Map<string, ClientStats>(), unread: true };
  }
}

export async function listClients(): Promise<ClientView[]> {
  const { latestHealth } = await import("./health.server");
  const { loadPulse } = await import("./pulse.server");
  const [tenants, { stats, unread }, ex, health] = await Promise.all([
    tenantDirectory(true),
    readStats(),
    extras(),
    latestHealth().catch(() => new Map()),
  ]);
  // Пульс считаем только клиентам v2; упавшее чтение — «нет данных», а не «затих».
  const pulses = await loadPulse(
    tenants
      .filter((t) => t.settings.served_by === "v2")
      .map((t) => ({
        id: t.id,
        status: t.status,
        createdAt: ex.get(t.id)?.created_at ?? null,
        lastOrderAt: stats.has(t.id) ? (stats.get(t.id)?.last_order_at ?? null) : undefined,
      })),
  ).catch((e) => {
    console.warn("[operator] пульс клиентов не прочитан:", e);
    return new Map<string, Pulse>();
  });
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
        undefined,
        pulses.get(t.id) ?? null,
        unread,
      );
    })
    .sort(
      (a, b) =>
        (b.pulse?.risk ?? 0) - (a.pulse?.risk ?? 0) ||
        (b.stats?.orders_30d ?? 0) - (a.stats?.orders_30d ?? 0) ||
        a.name.localeCompare(b.name, "ru"),
    );
}

export async function getClient(botId: string): Promise<ClientView> {
  const { latestHealth } = await import("./health.server");
  const health = await latestHealth([botId]).catch(() => new Map());
  const [t, { stats, unread }, ex, zernioEvents] = await Promise.all([
    requireTenant({ by: "id", value: botId }),
    readStats(),
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
    null,
    unread,
  );
}

/** Ключ в карте zernioLastEvents: профиль Zernio последнего события (у клиента v1 — профиль v1). */
const PROFILE_KEY = "@profile";

/**
 * Когда аккаунт последний раз присылал событие: по журналу zernio_logs,
 * ключ — accountId из payload, «*» — любое событие клиента. Оператор по
 * этому видит, что вебхук доходит именно до этого клиента. Под PROFILE_KEY —
 * профиль из последнего события: его записывают клиенту v1 перед переездом.
 */
export async function zernioLastEvents(botId: string, limit = 300): Promise<Map<string, string>> {
  const { data, error: readErr7 } = await serviceDb()
    .from("zernio_logs")
    .select("payload, created_at")
    .eq("bot_id", botId)
    .neq("status", "event")
    .neq("event_type", "telegram.update")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (readErr7) throw serverFailure(`[operator] журнал вебхуков не прочитан: ${readErr7.message}`);
  const out = new Map<string, string>();
  for (const row of data ?? []) {
    if (!out.has("*")) out.set("*", row.created_at);
    const p = row.payload as {
      account?: { accountId?: string; id?: string; _id?: string; profileId?: string };
    } | null;
    const id = p?.account?.accountId || p?.account?.id || p?.account?._id;
    if (id && !out.has(id)) out.set(id, row.created_at);
    const profile = p?.account?.profileId;
    if (typeof profile === "string" && profile && !out.has(PROFILE_KEY))
      out.set(PROFILE_KEY, profile);
  }
  return out;
}

export type EventView = { id: string; at: string; actor: string; kind: string; payload: Json };

export async function listEvents(botId: string, limit = 40): Promise<EventView[]> {
  const { data, error: readErr6 } = await serviceDb()
    .from("bot_events")
    .select("id, at, actor, kind, payload")
    .eq("bot_id", botId)
    .order("at", { ascending: false })
    .limit(limit);
  if (readErr6) throw serverFailure(`[operator] события клиента не прочитаны: ${readErr6.message}`);
  return data ?? [];
}

export type PlatformEvent = EventView & { botId: string; botName: string };

/** Журнал действий оператора по всем клиентам: кто, что, у кого. */
export async function listAllEvents(
  opts: {
    limit?: number;
    botId?: string | null;
    kind?: string | null;
    /** shop — действия команды магазина (core/audit/admin-audit), platform — все прочие. */
    who?: "shop" | "platform" | null;
  } = {},
): Promise<PlatformEvent[]> {
  let q = serviceDb()
    .from("bot_events")
    .select("id, at, actor, kind, payload, bot_id")
    .order("at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.botId) q = q.eq("bot_id", opts.botId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.who === "shop") q = q.like("actor", "admin:%");
  if (opts.who === "platform") q = q.not("actor", "like", "admin:%");
  const { data, error: readErr5 } = await q;
  if (readErr5) throw serverFailure(`[operator] журнал действий не прочитан: ${readErr5.message}`);
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
): Promise<Array<{ id: string; ok: boolean; error?: string; note?: string }>> {
  const out: Array<{ id: string; ok: boolean; error?: string; note?: string }> = [];
  for (const id of botIds) {
    try {
      const r = await setServedBy(id, "v2", actor);
      const note = storyTagsNote(r && "storyTags" in r ? r.storyTags : undefined);
      out.push({ id, ok: true, ...(note ? { note } : {}) });
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

export async function setModule(botId: string, key: ModuleKey, on: boolean, actor = "operator") {
  // Клиент на плане: модуль сверх плана записывается в сохранённые (core/plans).
  const onPlan = (await tenantDirectory(true)).find((t) => t.id === botId);
  if (onPlan && parsePlan(onPlan.plan)?.kind === "tier") {
    const { toggleModuleOnPlan } = await import("./plans.server");
    return toggleModuleOnPlan(onPlan, key, on, actor);
  }
  const def = moduleDef(key);
  if (on && def.status !== "available")
    throw new Error(`Модуль «${def.title}» ещё не реализован — включить нельзя.`);
  const { data, error: readErr4 } = await serviceDb()
    .from("bots")
    .select("modules")
    .eq("id", botId)
    .single();
  if (readErr4) throw serverFailure(`[operator] модули клиента не прочитаны: ${readErr4.message}`);
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
  // Один бот — один магазин: иначе вебхук переставится на другого клиента, и
  // покупатели чужого магазина пойдут в этот (продавец подключает бота сам).
  const taken = telegramBotTaken(await tenantDirectory(true), botId, me.result?.username);
  if (taken) throw new Error(`Этот бот уже подключён к магазину «${taken}».`);
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
  const taken = vipBotTaken(await tenantDirectory(true), botId, me.result?.username);
  if (taken)
    throw new UserError(
      "err.vip.botTaken",
      "Бот @{username} уже подключён к магазину «{shop}». Сначала отключите его там.",
      { username: me.result?.username ?? "", shop: taken },
    );
  await patchTenantSettings(botId, {
    vip: {
      token_enc: encryptSecret(token, e.SECRETS_KEY),
      username: me.result?.username ?? null,
      webhook_ok: false,
    },
  });
  await logEvent(botId, "webhook", { action: "vip_token", username: me.result?.username }, actor);
  const { ensureVipWebhook } = await import("@/channels/telegram/vip-webhook-setup.server");
  const webhook = await ensureVipWebhook(await requireTenant({ by: "id", value: botId }), true);
  await logEvent(botId, "webhook", { action: "vip_set", ...webhook }, actor);
  return { username: me.result?.username ?? null, webhook };
}

/**
 * Снять VIP-бота с магазина: токен из settings.vip стирается, VIP-маршрут и
 * кроны этого магазина бота больше не трогают. Вебхук в Telegram не удаляем:
 * бот мог уже уйти другому магазину, и его вебхук сломался бы; события на
 * старый адрес отвергает сам маршрут (без токена — 404).
 */
export async function disconnectVipBot(botId: string, actor = "operator") {
  const before = await requireTenant({ by: "id", value: botId });
  const username = before.settings.vip?.username ?? null;
  await patchTenantSettings(botId, { vip: null });
  await logEvent(botId, "webhook", { action: "vip_disconnect", username }, actor);
  return { username };
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
  const before = await requireTenant({ by: "id", value: botId });
  // Дата переезда — только при настоящем переходе с v1, повторное
  // «v2» её не сдвигает.
  const since =
    servedBy === "v2" && before.settings.served_by !== "v2"
      ? { served_by_since: new Date().toISOString() }
      : {};
  await patchTenantSettings(botId, { served_by: servedBy, ...since });
  await logEvent(botId, "webhook", { action: "served_by", value: servedBy }, actor);
  if (servedBy === "v2") {
    const storyTags: StoryTagsImport = await importLegacyStoryTags(botId).catch((e) => {
      console.warn(`[operator] story tags import for ${botId}: ${String(e)}`);
      return { error: e instanceof Error ? e.message : String(e) };
    });
    const r = { ...(await reinstallWebhook(botId, actor)), storyTags };
    await applyIceBreakers(botId);
    return r;
  }
  if (before.settings.served_by === "v2") {
    const { releaseIceBreakersToV1 } = await import("@/channels/zernio/ice-breakers.server");
    // Откат не держим: подсказки снимет повторный откат, а оператор видит причину в журнале.
    await releaseIceBreakersToV1(before).catch((e) =>
      logEvent(
        botId,
        "webhook",
        { action: "ice_breakers_release_failed", error: String(e) },
        actor,
      ),
    );
  }
  const { releasesTelegramOnSwitch } = await import("@/core/tenant/preflight");
  if (releasesTelegramOnSwitch(before.settings.served_by, servedBy)) {
    const { releaseTelegramToV1 } = await import("@/channels/telegram/webhook-setup.server");
    await releaseTelegramToV1(before).catch((e) =>
      console.warn(`[operator] menu button reset for ${botId}: ${String(e)}`),
    );
  }
  return null;
}

/** Быстрые вопросы Instagram после переезда; сбой не мешает переезду — крон повторит. */
async function applyIceBreakers(botId: string): Promise<void> {
  const { refreshIceBreakers } = await import("@/channels/zernio/ice-breakers.server");
  const r = await refreshIceBreakers(botId);
  if (!r.ok) console.warn(`[operator] ice breakers for ${botId}: ${r.error}`);
}

/**
 * Перенос тегов сторис v1 при переключении (app/operator/story-tags-import):
 * недостающие дописываются к тегам v2, не влезшее в предел — в журнал и в
 * итог переключения оператору.
 */
export async function importLegacyStoryTags(
  botId: string,
): Promise<{ added: number; dropped: number }> {
  const { planLegacyStoryTags } = await import("./story-tags-import.server");
  const { saveStoryTags } = await import("@/core/consultant/story-tags");
  const ctx = tenantContext(await requireTenant({ by: "id", value: botId }));
  const plan = await planLegacyStoryTags(ctx, botId);
  if (!plan.add) return { added: 0, dropped: plan.dropped };
  await saveStoryTags(ctx, plan.merged);
  await logEvent(botId, "meta", {
    story_tags_imported: plan.add,
    ...(plan.dropped ? { story_tags_dropped: plan.dropped } : {}),
  });
  return { added: plan.add, dropped: plan.dropped };
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

export async function setAddressing(botId: string, slug: string | null, rawHosts: string[]) {
  // Домен платформы или кривое имя магазину не записываем (core/tenant/custom-domain).
  const { cleanHosts } = await import("@/core/tenant/custom-domain");
  const clean = cleanHosts(rawHosts, env().APP_URL);
  if ("error" in clean) throw new Error(clean.error);
  const hosts = clean.hosts;
  const taken = addressConflict(await tenantDirectory(true), botId, { slug, hosts });
  if (taken) throw new Error(`Адрес «${taken.what}» уже занят клиентом «${taken.owner}».`);
  await patchTenantSettings(botId, { slug: slug ?? "", hosts });
  await logEvent(botId, "meta", { slug, hosts });
  // Кнопка «Магазин» в боте — на новый адрес витрины; сбой Telegram адрес не отменяет.
  const { refreshMenuButton } = await import("@/channels/telegram/webhook-setup.server");
  await refreshMenuButton(await requireTenant({ by: "id", value: botId })).catch((e) =>
    console.warn("[operator] menu button:", e),
  );
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
  /** Отпечаток решённой задачи /signup — одна задача на одну регистрацию. */
  challenge?: string;
  /** Откуда пришёл продавец (core/signup/origin); уже проверено. */
  signup?: SignupOrigin | null;
}) {
  const { data: dup, error: dupErr } = await serviceDb()
    .from("bots")
    .select("id")
    .eq("owner_id", input.ownerId)
    .limit(1)
    .maybeSingle();
  if (dupErr)
    throw serverFailure(`[operator] идентификатор клиента не проверен: ${dupErr.message}`);
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
  if (input.signup) settings.signup = input.signup;
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
      ...(input.challenge ? { challenge: input.challenge } : {}),
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
  template: OwnerTemplateKey | null = null,
): Promise<DeliveryReport> {
  const t = await requireTenant({ by: "id", value: botId });
  const ctx = tenantContext(t);
  const { adminRecipients } = await import("@/core/notify/recipients");
  const { deliverToEach } = await import("@/core/notify/deliver");
  const api = telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
  const r = await deliverToEach(await adminRecipients(ctx), (id) =>
    api.call("sendMessage", { chat_id: id, text }),
  );
  // Полный текст в журнале (до 1000 знаков): оператор видит, что именно писал клиенту.
  await logEvent(botId, "message", {
    text: text.slice(0, 1000),
    template,
    delivered: r.delivered.length,
    failed: r.failed.length,
  });
  return r;
}

export type OwnerMessageDraft = {
  locale: Locale;
  templates: ReturnType<typeof ownerTemplates>;
};

/** Шаблоны сообщений владельцу на языке его админки (иначе языка магазина, иначе русский). */
export async function ownerMessageDraft(botId: string): Promise<OwnerMessageDraft> {
  const t = await requireTenant({ by: "id", value: botId });
  const locale = await sellerLocaleSafe(tenantContext(t));
  const ex = (await extras([botId])).get(botId);
  const until = ex?.subscription_expires_at ?? null;
  const paidUntil = until
    ? new Date(until).toLocaleDateString("ru-RU", { timeZone: env().APP_TIMEZONE })
    : null;
  return { locale, templates: ownerTemplates(locale, { shop: t.name, paidUntil }) };
}

export type OwnerMessageLogItem = {
  id: string;
  at: string;
  text: string;
  template: string | null;
  delivered: number;
  failed: number;
};

/** Журнал сообщений владельцу: последние 30 из `bot_events` (kind = message). */
export async function listOwnerMessages(botId: string): Promise<OwnerMessageLogItem[]> {
  const { data, error } = await serviceDb()
    .from("bot_events")
    .select("id, at, payload")
    .eq("bot_id", botId)
    .eq("kind", "message")
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(30);
  if (error) throw serverFailure(`[operator] журнал сообщений не прочитан: ${error.message}`);
  return (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      at: r.at,
      text: typeof p.text === "string" ? p.text : "",
      template: typeof p.template === "string" ? p.template : null,
      delivered: Number(p.delivered ?? 0),
      failed: Number(p.failed ?? 0),
    };
  });
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

/**
 * Заявки на тариф из админки продавца лежат в той же очереди: `plan:<уровень>`
 * — переход на план, `addon:<канал>` — канал сверх плана. Схема не меняется,
 * module_key — свободный текст.
 */
function planRequest(key: string): {
  title: string;
  price: number | null;
  alreadyOn: (t: Tenant) => boolean;
  apply: (botId: string, actor: string) => Promise<void>;
} | null {
  const [kind, value] = key.split(":");
  if (kind === "plan" && (PLAN_TIERS as readonly string[]).includes(value ?? "")) {
    const tier = value as PlanTier;
    return {
      title: `Переход на план ${TIER_TITLES[tier]}`,
      price: MONTHLY_PRICE[tier],
      alreadyOn: (t) => {
        const p = parsePlan(t.plan);
        return p?.kind === "tier" && p.tier === tier;
      },
      apply: async (botId, actor) => {
        const { setPlan } = await import("./plans.server");
        const t = (await tenantDirectory(true)).find((x) => x.id === botId);
        await setPlan(
          botId,
          {
            tier,
            period: t?.settings.billing?.period ?? "month",
            addons: t?.settings.billing?.addons ?? [],
          },
          actor,
        );
      },
    };
  }
  if (kind === "addon" && (ADDON_KEYS as string[]).includes(value ?? "")) {
    const addon = value as AddonKey;
    return {
      title: `${ADDONS[addon].title} сверх плана`,
      price: ADDON_MONTHLY_PRICE[addon],
      alreadyOn: (t) => Boolean(t.settings.billing?.addons?.includes(addon)),
      apply: async (botId, actor) => {
        const { setPlan } = await import("./plans.server");
        const t = (await tenantDirectory(true)).find((x) => x.id === botId);
        const p = parsePlan(t?.plan);
        if (p?.kind !== "tier") throw new Error("У клиента нет плана — сначала выберите план.");
        const addons = [...new Set([...(t?.settings.billing?.addons ?? []), addon])];
        await setPlan(
          botId,
          { tier: p.tier, period: t?.settings.billing?.period ?? "month", addons },
          actor,
        );
      },
    };
  }
  return null;
}

/** Единая очередь «Заказать подключение» со всех клиентов, самая старая внизу. */
export async function listModuleRequests(): Promise<ModuleRequestView[]> {
  const data = await pageAll<{
    id: string;
    bot_id: string;
    module_key: string;
    requested_at: string;
  }>(
    (from, to) =>
      serviceDb()
        .from("module_requests")
        .select("id, bot_id, module_key, requested_at")
        .eq("status", "pending")
        .order("requested_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    "Заявки на подключение",
  );
  if (!data.length) return [];
  const tenants = await tenantDirectory(true);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  return data
    .filter((r) => byId.has(r.bot_id))
    .map((r) => {
      const t = byId.get(r.bot_id)!;
      const key = r.module_key as ModuleKey;
      const def = MODULES[key];
      const plan = planRequest(r.module_key);
      return {
        id: r.id,
        botId: r.bot_id,
        clientName: t.name,
        moduleKey: key,
        moduleTitle: plan ? plan.title : (def?.title ?? r.module_key),
        price: plan ? plan.price : (def?.price ?? null),
        requestedAt: r.requested_at,
        alreadyOn: plan ? plan.alreadyOn(t) : Boolean(t.modules[key]),
      };
    });
}

export async function pendingModuleRequestCount(): Promise<number> {
  const { count, error: readErr3 } = await serviceDb()
    .from("module_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (readErr3)
    throw serverFailure(`[operator] заявки на модули не посчитаны: ${readErr3.message}`);
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
  const { data: req, error: reqErr } = await serviceDb()
    .from("module_requests")
    .select("id, bot_id, module_key, status")
    .eq("id", id)
    .maybeSingle();
  if (reqErr) throw serverFailure(`[operator] заявка не прочитана: ${reqErr.message}`);
  if (!req) throw new Error("Заявка не найдена.");
  if (req.status !== "pending") return { notified: false };
  const key = req.module_key as ModuleKey;
  const plan = planRequest(req.module_key);
  let notified = false;
  if (action === "enable" && plan) {
    await plan.apply(req.bot_id, actor);
    notified = await notifyOwner(req.bot_id, `✅ ${plan.title}: готово.`)
      .then((r) => r.delivered.length > 0)
      .catch(() => false);
  } else if (action === "enable") {
    await setModule(req.bot_id, key, true, actor);
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
  if (updError) throw serverFailure(`Не удалось закрыть заявку: ${updError.message}`);
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
          error: r.failed[0]?.reason ?? NO_RECIPIENTS_REASON,
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

/** Дневной предел ИИ-консультанта клиента: свой или общий, и сколько потрачено сегодня. */
export async function consultantBudget(botId: string) {
  const { CONSULTANT_LIMITS, CONSULTANT_LIMIT_MAX, limitsFor, parseDaily, today } =
    await import("@/core/consultant/budget");
  const t = await requireTenant({ by: "id", value: botId });
  const { data, error: readErr2 } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .eq("key", "consultant_daily")
    .maybeSingle();
  if (readErr2)
    throw serverFailure(`[operator] расход консультанта не прочитан: ${readErr2.message}`);
  const custom = t.settings.consultant_limits ?? null;
  return {
    limits: limitsFor(custom),
    custom: Boolean(
      custom && [custom.daily_usd, custom.daily_calls, custom.daily_tests].some((v) => v != null),
    ),
    defaults: CONSULTANT_LIMITS,
    max: CONSULTANT_LIMIT_MAX,
    today: parseDaily(data?.value, today()),
    search: t.settings.consultant_search === true,
    pricelist: t.settings.consultant_pricelist?.enabled === true,
    pricelistOptions: {
      hours: t.settings.consultant_pricelist?.hours ?? null,
      rateSource: t.settings.consultant_pricelist?.rate_source ?? "vtb",
      rateUrl: t.settings.consultant_pricelist?.rate_url ?? "",
    },
  };
}

/** Поиск консультанта по каталогу инструментом (core/consultant/catalog-tool.server). */
export async function setConsultantSearch(botId: string, on: boolean, actor = "operator") {
  await patchTenantSettings(botId, { consultant_search: on });
  await logEvent(botId, "meta", { consultant_search: on }, actor);
}

/** Консультант «по прайсу» BOVI (core/consultant/pricelist) — включает оператор. */
export async function setConsultantPricelist(botId: string, on: boolean, actor = "operator") {
  await patchTenantSettings(botId, { consultant_pricelist: { enabled: on } });
  await logEvent(botId, "meta", { consultant_pricelist: on }, actor);
}

/**
 * Часы магазина, источник курса и страница банка на finkaz для консультанта
 * по прайсу. Проверка значений — та же, что при чтении (settingsFromJson):
 * записываем только то, что потом прочтётся.
 */
export async function setConsultantPricelistOptions(
  botId: string,
  o: {
    hours: { open: number; close: number } | null;
    rateSource: "vtb" | "finkaz" | "manual";
    rateUrl: string;
  },
  actor = "operator",
) {
  const h = o.hours;
  if (h && (h.open === h.close || [h.open, h.close].some((n) => !(n >= 0 && n <= 24))))
    throw new Error("Часы работы — от 0 до 24, открытие и закрытие не совпадают.");
  const url = o.rateUrl.trim();
  if (url && !/^https:\/\/finkaz\.kz\/[a-z0-9-]+\/exchange-rates\/?$/i.test(url))
    throw new Error("Страница курса — адрес вида https://finkaz.kz/kaspi-bank/exchange-rates.");
  const patch = {
    hours: h ?? undefined,
    rate_source: o.rateSource,
    rate_url: url || undefined,
  };
  await patchTenantSettings(botId, { consultant_pricelist: patch });
  await logEvent(botId, "meta", { consultant_pricelist_options: patch }, actor);
}

/** Дневной предел умного поиска клиента в долларах: свой или общий, и расход сегодня. */
export async function smartSearchBudget(botId: string) {
  const { DAILY_USD_LIMIT, SMART_SEARCH_USD_MAX, dailySpendUsd, smartSearchUsdLimit } =
    await import("@/core/search/smart-pure");
  const t = await requireTenant({ by: "id", value: botId });
  const { data, error: readErr } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .eq("key", "smart_search_daily_spend")
    .maybeSingle();
  if (readErr)
    throw serverFailure(`[operator] расход умного поиска не прочитан: ${readErr.message}`);
  const custom = t.settings.smart_search_limits?.daily_usd;
  return {
    limitUsd: smartSearchUsdLimit(t.settings.smart_search_limits),
    custom: typeof custom === "number",
    defaultUsd: DAILY_USD_LIMIT,
    maxUsd: SMART_SEARCH_USD_MAX,
    todayUsd: dailySpendUsd(data?.value),
  };
}

/** Свой предел умного поиска; null — общий предел платформы. */
export async function setSmartSearchLimit(
  botId: string,
  dailyUsd: number | null,
  actor = "operator",
) {
  const value = dailyUsd == null ? null : { daily_usd: dailyUsd };
  await patchTenantSettings(botId, { smart_search_limits: value });
  await logEvent(botId, "meta", { smart_search_limits: value }, actor);
}

/** Свой предел клиента; null — вернуть общий предел платформы. */
export async function setConsultantLimits(
  botId: string,
  limits: { dailyUsd: number | null; dailyCalls: number | null; dailyTests: number | null } | null,
  actor = "operator",
) {
  const value = limits
    ? { daily_usd: limits.dailyUsd, daily_calls: limits.dailyCalls, daily_tests: limits.dailyTests }
    : null;
  await patchTenantSettings(botId, { consultant_limits: value });
  await logEvent(botId, "meta", { consultant_limits: value }, actor);
}

/* ── «Несколько ботов»: магазины одного продавца (core/tenant/shop-group) ── */

export type ShopGroupView = {
  group: string | null;
  members: { id: string; name: string }[];
  candidates: { id: string; name: string }[];
};

export async function shopGroupView(botId: string): Promise<ShopGroupView> {
  const { shopGroup } = await import("@/core/tenant/shop-group");
  const dir = await tenantDirectory(true);
  const self = dir.find((t) => t.id === botId);
  if (!self) throw new Error("Клиент не найден.");
  const g = shopGroup(self);
  const brief = (t: Tenant) => ({ id: t.id, name: t.name });
  const byName = (a: Tenant, b: Tenant) => a.name.localeCompare(b.name, "ru");
  return {
    group: g,
    members: g
      ? dir
          .filter((t) => shopGroup(t) === g)
          .sort(byName)
          .map(brief)
      : [],
    // Магазин из чужой группы связать нельзя (planLink), поэтому не предлагаем.
    candidates: dir
      .filter((t) => t.id !== botId && (!g || !shopGroup(t)))
      .sort(byName)
      .map(brief),
  };
}

async function applyGroupChanges(
  changes: { botId: string; group: string | null }[],
  actor: string,
) {
  for (const c of changes) {
    const value = c.group ? { group: c.group } : null;
    await patchTenantSettings(c.botId, { multi_bot: value });
    await logEvent(c.botId, "meta", { multi_bot: value }, actor);
  }
  invalidateTenantDirectory();
}

export async function linkShops(botId: string, otherId: string, actor = "operator") {
  const { planLink } = await import("@/core/tenant/shop-group");
  const dir = await tenantDirectory(true);
  const a = dir.find((t) => t.id === botId);
  const b = dir.find((t) => t.id === otherId);
  if (!a || !b) throw new Error("Клиент не найден.");
  // Группа — только отсюда и только свежий uuid: не угадать и не совпасть с чужой.
  const plan = planLink(a, b, crypto.randomUUID());
  if ("error" in plan) throw new Error(plan.error);
  await applyGroupChanges(plan.changes, actor);
}

export async function unlinkShop(botId: string, actor = "operator") {
  const { planUnlink } = await import("@/core/tenant/shop-group");
  const dir = await tenantDirectory(true);
  const t = dir.find((x) => x.id === botId);
  if (!t) throw new Error("Клиент не найден.");
  await applyGroupChanges(planUnlink(dir, t), actor);
}
