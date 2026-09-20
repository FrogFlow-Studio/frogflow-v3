import { env } from "@/config/env";
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
  | "message";

export async function logEvent(
  botId: string,
  kind: EventKind,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await serviceDb()
    .from("bot_events")
    .insert({ bot_id: botId, actor: "operator", kind, payload: payload as Json });
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
    createdAt: extra.created_at,
    stats,
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
  const [tenants, stats, ex] = await Promise.all([
    tenantDirectory(true),
    clientStats().catch(() => new Map<string, ClientStats>()),
    extras(),
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
      );
    })
    .sort(
      (a, b) =>
        (b.stats?.orders_30d ?? 0) - (a.stats?.orders_30d ?? 0) ||
        a.name.localeCompare(b.name, "ru"),
    );
}

export async function getClient(botId: string): Promise<ClientView> {
  const [t, stats, ex] = await Promise.all([
    requireTenant({ by: "id", value: botId }),
    clientStats().catch(() => new Map<string, ClientStats>()),
    extras([botId]),
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
  );
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

export async function connectTelegram(botId: string, token: string) {
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
  await logEvent(botId, "webhook", { action: "token", username: me.result?.username });
  return { username: me.result?.username ?? null };
}

export async function setServedBy(botId: string, servedBy: "v1" | "v2") {
  await patchTenantSettings(botId, { served_by: servedBy });
  await logEvent(botId, "webhook", { action: "served_by", value: servedBy });
  if (servedBy === "v2") return reinstallWebhook(botId);
  return null;
}

export async function reinstallWebhook(botId: string) {
  const t = await requireTenant({ by: "id", value: botId });
  const r = await ensureTelegramWebhook(t, true);
  await logEvent(botId, "webhook", { action: "set", ...r });
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
  if (slug) {
    const taken = (await tenantDirectory(true)).find(
      (t) => t.settings.slug === slug && t.id !== botId,
    );
    if (taken) throw new Error(`Адрес «${slug}» уже занят клиентом «${taken.name}».`);
  }
  await patchTenantSettings(botId, { slug: slug ?? "", hosts });
  await logEvent(botId, "meta", { slug, hosts });
}

export async function setZernioAccounts(botId: string, accountIds: string[]) {
  await patchTenantSettings(botId, { zernio: { account_ids: accountIds } });
  await logEvent(botId, "meta", { zernio_account_ids: accountIds });
}

export async function setAdminCredentials(botId: string, username: string, password: string) {
  const taken = (await tenantDirectory(true)).find(
    (t) => t.settings.admin?.username === username && t.id !== botId,
  );
  if (taken) throw new Error(`Логин «${username}» уже используется клиентом «${taken.name}».`);
  await patchTenantSettings(botId, { admin: { username, password_hash: hashPassword(password) } });
  await logEvent(botId, "meta", { admin_username: username });
}

export async function createClient(input: {
  name: string;
  ownerId: string;
  vertical: VerticalKey;
  ownerName?: string;
  ownerContact?: string;
}) {
  const { data: dup } = await serviceDb()
    .from("bots")
    .select("id")
    .eq("owner_id", input.ownerId)
    .limit(1)
    .maybeSingle();
  if (dup) throw new Error(`Идентификатор «${input.ownerId}» уже занят.`);
  const modules = Object.fromEntries(
    MODULE_KEYS.map((k) => [k, moduleDef(k).price === null && moduleDef(k).status === "available"]),
  );
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
      settings: { served_by: "v2", slug: input.ownerId },
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  invalidateTenantDirectory();
  await logEvent(data.id, "onboard", { name: input.name, vertical: input.vertical });
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
