/**
 * Предполётная проверка перед переводом клиента на v2: собирает входные
 * данные (токен через getMe, реквизиты, товары, логин продавца) и отдаёт
 * вердикт из core/tenant/preflight. Оператор видит его в карточке клиента;
 * setServedBy отказывает при блокирующих пунктах.
 */
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { MODULE_KEYS } from "@/core/modules/registry";
import { requireTenant, tenantContext, tenantDirectory } from "@/core/tenant/resolve.server";
import { foreignZernioAccounts } from "@/core/tenant/zernio-accounts";
import { decryptSecret, isEncryptedSecret } from "@/core/secrets/vault";
import { evaluatePreflight, type Preflight } from "@/core/tenant/preflight";
import { withVipChecks, type VipPreflightInput } from "@/core/tenant/preflight-vip";
import type { Tenant } from "@/core/tenant/types";
import { telegramApi } from "@/channels/telegram/api";
import { MATERIAL_COLUMNS, productSellable, type ProductWithFiles } from "@/core/catalog/materials";
import { computeState, readPolicy } from "@/core/billing/subscription";
import { sellerIds } from "@/core/notify/recipients";
import { pageAll } from "@/core/db/page";
import { isMailConfigured } from "@/core/mail/mail.server";
import { planLegacyStoryTags } from "./story-tags-import.server";
import { serverFailure } from "@/lib/server-failure";

const DAY_MS = 86_400_000;

/**
 * Заказы клиента за 30 дней: из Instagram и WhatsApp и с почтой покупателя
 * вне Telegram (сайт, копия выдачи письмом). Ошибка чтения — сбой проверки,
 * а не ноль: ноль спрятал бы блокирующий пункт.
 */
async function recentOrders(botId: string, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const recent = () =>
    serviceDb()
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .gte("created_at", since);
  const [channels, mailed] = await Promise.all([
    recent().in("platform", ["instagram", "whatsapp"]),
    recent().in("platform", ["instagram", "whatsapp", "web"]).not("customer_email", "is", null),
  ]);
  const error = channels.error ?? mailed.error;
  if (error) throw serverFailure(`Проверка переезда: заказы не прочитаны (${error.message})`);
  return { channels: channels.count ?? 0, mailed: mailed.count ?? 0 };
}

/** Сколько продавцов жмут «подтвердить»: admin_chat_id плюс владелец из карточки. */
async function sellerChats(botId: string): Promise<number> {
  const db = serviceDb();
  const [{ data }, { data: bot }] = await Promise.all([
    db
      .from("app_settings")
      .select("value")
      .eq("bot_id", botId)
      .eq("key", "admin_chat_id")
      .maybeSingle(),
    db.from("bots").select("owner_telegram_id").eq("id", botId).maybeSingle(),
  ]);
  return sellerIds(data?.value, bot?.owner_telegram_id).length;
}

async function deliveringOrders(botId: string): Promise<number> {
  const { count } = await serviceDb()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("status", "delivering");
  return count ?? 0;
}

/** Активные цифровые товары, которые v2 не даст купить: нет ни одного файла. */
async function unsellableProducts(botId: string): Promise<number> {
  const rows = await pageAll(
    (from, to) =>
      serviceDb()
        .from("products")
        .select(`id, ${MATERIAL_COLUMNS}`)
        .eq("bot_id", botId)
        .eq("is_active", true)
        .range(from, to),
    "товары для проверки переезда",
  );
  return rows.filter((p) => !productSellable(p as unknown as ProductWithFiles)).length;
}

async function subscriptionExpiresAt(botId: string): Promise<string | null> {
  const { data } = await serviceDb()
    .from("bots")
    .select("subscription_expires_at")
    .eq("id", botId)
    .maybeSingle();
  return data?.subscription_expires_at ?? null;
}

async function countRows(table: "payment_methods" | "products", botId: string): Promise<number> {
  const { count } = await serviceDb()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("bot_id", botId)
    .eq("is_active", true);
  return count ?? 0;
}

export async function preflight(botId: string): Promise<Preflight> {
  const t = await requireTenant({ by: "id", value: botId });
  const tokenPresent = isEncryptedSecret(t.telegramTokenEnc);
  let tokenOk: boolean | null = null;
  let botUsername: string | null = t.settings.telegram?.username ?? null;
  let mainBotId: number | null = null;
  if (tokenPresent) {
    try {
      const token = decryptSecret(t.telegramTokenEnc!, env().SECRETS_KEY);
      const me = await telegramApi(token, env().TELEGRAM_API_BASE).call<{
        id?: number;
        username?: string;
      }>("getMe", {});
      tokenOk = me.ok;
      if (me.ok && me.result?.username) botUsername = me.result.username;
      if (me.ok && me.result?.id) mainBotId = me.result.id;
    } catch {
      tokenOk = false;
    }
  }
  const [paymentMethods, products, chats, delivering, unsellable, expiresAt, orders30d, storyTags] =
    await Promise.all([
      countRows("payment_methods", botId),
      countRows("products", botId),
      sellerChats(botId),
      deliveringOrders(botId),
      unsellableProducts(botId),
      subscriptionExpiresAt(botId),
      recentOrders(botId),
      planLegacyStoryTags(tenantContext(t), botId),
    ]);
  const zernioAccountIds = t.settings.zernio?.account_ids ?? [];
  const policy = readPolicy(t.settings);
  const vip = t.modules.vip ? await vipInput(t, mainBotId, chats) : null;
  const base = evaluatePreflight({
    modulesOn: MODULE_KEYS.filter((k) => t.modules[k]),
    tokenPresent,
    tokenOk,
    botUsername,
    paymentMethods,
    products,
    adminLogin: Boolean(t.settings.admin?.username && t.settings.admin?.password_hash),
    appUrl: t.appUrl,
    sellerChats: chats,
    deliveringOrders: delivering,
    unsellableProducts: unsellable,
    slug: t.settings.slug ?? null,
    subscription: {
      state: computeState(expiresAt, policy).state,
      suspend: policy.on_overdue === "suspend",
    },
    zernioConflicts: foreignZernioAccounts(await tenantDirectory(), botId, zernioAccountIds).map(
      (f) => f.id,
    ),
    channelOrders30d: orders30d.channels,
    zernioAccounts: zernioAccountIds.length,
    mail: {
      configured: isMailConfigured(),
      needed: Boolean(t.modules.web_storefront) || orders30d.mailed > 0,
    },
    storyTags: {
      v1: storyTags.v1,
      v2: storyTags.v2,
      add: storyTags.add,
      dropped: storyTags.dropped,
      max: storyTags.max,
    },
  });
  return withVipChecks(base, vip);
}

/**
 * VIP-бот клиента (модуль vip): свой токен в settings.vip.token_enc, группа в
 * app_settings.vip_group_id. Без них после переезда VIP-бот замолчит, а
 * продление подписок встанет (ensureVipWebhook такого клиента пропускает).
 */
async function vipInput(
  t: Tenant,
  mainBotId: number | null,
  sellerChats: number,
): Promise<VipPreflightInput> {
  const enc = t.settings.vip?.token_enc;
  const tokenPresent = isEncryptedSecret(enc);
  let tokenOk: boolean | null = null;
  let username: string | null = t.settings.vip?.username ?? null;
  let vipBotId: number | null = null;
  if (tokenPresent) {
    try {
      const token = decryptSecret(enc!, env().SECRETS_KEY);
      const me = await telegramApi(token, env().TELEGRAM_API_BASE).call<{
        id?: number;
        username?: string;
      }>("getMe", {});
      tokenOk = me.ok;
      if (me.ok && me.result?.username) username = me.result.username;
      if (me.ok && me.result?.id) vipBotId = me.result.id;
    } catch {
      tokenOk = false;
    }
  }
  const { data, error } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", t.id)
    .eq("key", "vip_group_id")
    .maybeSingle();
  if (error) throw serverFailure(`Проверка переезда: VIP-группа не прочитана (${error.message})`);
  return {
    tokenPresent,
    tokenOk,
    username,
    sameAsMain: vipBotId !== null && vipBotId === mainBotId,
    groupSet: Boolean(data?.value?.trim()),
    sellerChats,
  };
}
