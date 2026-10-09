import { pageAll } from "@/core/db/page";
import { env } from "@/config/env";
import { signupOriginLabel } from "@/core/signup/origin";
import {
  computeState,
  readPolicy,
  type OverduePolicy,
  type SubscriptionState,
} from "@/core/billing/subscription";
import { serviceDb } from "@/core/db/client.server";
import { debtByClient } from "./client-health";
import { isDown, operatorHint } from "@/channels/zernio/guard";
import { MODULE_KEYS, type ModuleKey } from "@/core/modules/registry";
import { VERTICALS, type VerticalKey } from "@/core/verticals/registry";
import { requireTenant, tenantDirectory } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import type { Pulse } from "./pulse";
import { serverFailure } from "@/lib/server-failure";
import { zernioLastEvents } from "./client-events.server";

/** Список клиентов и карточка клиента. */

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
  /** VIP-бот (модуль vip): второй токен в settings.vip. */
  vipBot: { connected: boolean; username: string | null; webhookOk: boolean };
  zernioAccounts: string[];
  /** Своя дата начала комиссии (`settings.commission.start`); null — общая. */
  commissionStart: string | null;
  /** Месяцы, за которые комиссия уже вошла в счёт за подписку: месяц → номер счёта. */
  commissionBilled: Array<{ month: string; invoiceId: string }>;
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
    /** Каналы, которые страж признал лежащими: час начала и причина (для таблицы здоровья). */
    down: Array<{ platform: string; hint: string }>;
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
  /** Выставленные, но не оплаченные счета за подписку; null — не читали или не прочиталось (см. debtUnread). */
  debt: { amount: number; count: number } | null;
  debtUnread: boolean;
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
  debt: ClientView["debt"] = null,
  debtUnread = false,
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
    vipBot: {
      connected: Boolean(t.settings.vip?.token_enc),
      username: t.settings.vip?.username ?? null,
      webhookOk: t.settings.vip?.webhook_ok === true,
    },
    zernioAccounts: t.settings.zernio?.account_ids ?? [],
    commissionStart: t.settings.commission?.start ?? null,
    commissionBilled: Object.entries(t.settings.commission?.billed ?? {})
      .map(([month, invoiceId]) => ({ month, invoiceId }))
      .sort((a, b) => a.month.localeCompare(b.month)),
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
      down: Object.entries(t.settings.zernio?.guard ?? {})
        .filter(([, e]) => isDown(e))
        .map(([platform, e]) => ({
          platform,
          hint: operatorHint(e!, t.settings.timezone ?? env().APP_TIMEZONE),
        })),
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
    debt,
    debtUnread,
  };
}

export async function extras(ids?: string[]) {
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

/** Неоплаченные счета за подписку по клиентам; сбой — null, чтобы панель написала «не прочитано», а не «долга нет». */
async function readDebt(): Promise<Map<string, { amount: number; count: number }> | null> {
  try {
    const rows = await pageAll<{ id: string; bot_id: string; amount: number | string }>(
      (from, to) =>
        serviceDb()
          .from("subscription_invoices")
          .select("id, bot_id, amount")
          .in("status", ["sent", "proof_uploaded"])
          .order("id", { ascending: true })
          .range(from, to),
      "Неоплаченные счета не прочитаны",
    );
    return debtByClient(rows);
  } catch (e) {
    console.warn("[operator] долги клиентов не прочитаны:", e);
    return null;
  }
}

export async function listClients(): Promise<ClientView[]> {
  const { latestHealth } = await import("./health.server");
  const { loadPulse } = await import("./pulse.server");
  const [tenants, { stats, unread }, ex, health, debts] = await Promise.all([
    tenantDirectory(true),
    readStats(),
    extras(),
    latestHealth().catch(() => new Map()),
    readDebt(),
  ]);
  // Пульс считаем только клиентам v2; упавшее чтение — «нет данных», а не «затих».
  const pulses = await loadPulse(
    tenants
      .filter((t) => t.settings.served_by === "v2")
      .map((t) => ({
        id: t.id,
        status: t.status,
        createdAt: ex.get(t.id)?.created_at ?? null,
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
        debts?.get(t.id) ?? null,
        debts === null,
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
  const t = await requireTenant({ by: "id", value: botId });
  const [{ stats, unread }, ex, zernioEvents] = await Promise.all([
    readStats(),
    extras([botId]),
    zernioLastEvents(botId, t.settings.zernio?.account_ids ?? []).catch(
      () => new Map<string, string>(),
    ),
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
export const PROFILE_KEY = "@profile";
