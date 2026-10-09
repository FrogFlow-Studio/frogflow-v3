import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import type { Database } from "@/core/db-types";
import { MODULE_KEYS, MODULES, moduleDef, type ModuleKey } from "@/core/modules/registry";
import { type VerticalKey } from "@/core/verticals/registry";
import { parsePlan } from "@/core/plans/registry";
import { encryptSecret } from "@/core/secrets/vault";
import { telegramApi } from "@/channels/telegram/api";
import {
  invalidateTenantDirectory,
  patchTenantSettings,
  requireTenant,
  tenantContext,
  tenantDirectory,
} from "@/core/tenant/resolve.server";
import { ensureTelegramWebhook, type WebhookState } from "@/channels/telegram/webhook-setup.server";
import type { Tenant } from "@/core/tenant/types";
import { foreignZernioAccounts } from "@/core/tenant/zernio-accounts";
import { pricelistDefaultFor } from "@/core/consultant/pricelist/mode";
import { addressConflict, telegramBotTaken, vipBotTaken } from "@/core/tenant/directory";
import { UserError } from "@/core/i18n/user-error";
import { adminLoginTaken } from "@/core/auth/roles";
import { hashPassword } from "@/app/auth/password";
import { telegramWebhookUrl } from "@/channels/telegram/secret";
import { serverFailure } from "@/lib/server-failure";
import { storyTagsNote, type StoryTagsImport } from "./story-tags-import.server";
import { logEvent } from "./client-log.server";

/** Настройки клиента: переезд, модули, каналы, вебхуки, доступы. */

type BotUpdate = Database["public"]["Tables"]["bots"]["Update"];

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
  // Ниша сменилась на консультанта BOVI — флаг «по прайсу», если оператор его не трогал.
  const before =
    patch.vertical !== undefined
      ? (await tenantDirectory(true)).find((t) => t.id === botId)
      : undefined;
  const { error } = await serviceDb().from("bots").update(upd).eq("id", botId);
  if (error) throw serverFailure(error.message);
  const pricelist =
    before && before.vertical !== patch.vertical
      ? pricelistDefaultFor(patch.vertical!, before.settings.consultant_pricelist)
      : null;
  if (pricelist) await patchTenantSettings(botId, { consultant_pricelist: pricelist });
  invalidateTenantDirectory();
  await logEvent(botId, "meta", {
    ...(patch as Record<string, unknown>),
    ...(pricelist ? { consultant_pricelist: true } : {}),
  });
}

export async function setStatus(botId: string, status: Tenant["status"]) {
  const { error } = await serviceDb().from("bots").update({ status }).eq("id", botId);
  if (error) throw serverFailure(error.message);
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
  if (error) throw serverFailure(error.message);
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
  if (error) throw serverFailure(error.message);
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
    const r = {
      ...(await reinstallWebhook(botId, actor)),
      storyTags,
      vip: await moveVipBot(botId, actor),
    };
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

/**
 * VIP-бот переезжает вместе с магазином: вебхук сразу сюда, а не через час
 * кроном ensure-webhook — иначе после паузы v1 заявки и чеки VIP до следующего
 * часа копятся в Telegram. Без модуля или токена — null; сбой не мешает
 * переезду (крон повторит), оператор видит его в ответе и журнале.
 */
async function moveVipBot(botId: string, actor: string): Promise<WebhookState | null> {
  const t = await requireTenant({ by: "id", value: botId });
  if (!t.modules.vip || !t.settings.vip?.token_enc) return null;
  const { ensureVipWebhook } = await import("@/channels/telegram/vip-webhook-setup.server");
  const r = await ensureVipWebhook(t, true).catch((e): WebhookState => ({
    ok: false,
    url: null,
    pending: 0,
    error: String(e),
  }));
  await logEvent(botId, "webhook", { action: "vip_set", ...r }, actor);
  return r;
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
