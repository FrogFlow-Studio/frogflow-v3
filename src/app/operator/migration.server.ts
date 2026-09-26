/**
 * Предполётная проверка перед переводом клиента на v2: собирает входные
 * данные (токен через getMe, реквизиты, товары, логин продавца) и отдаёт
 * вердикт из core/tenant/preflight. Оператор видит его в карточке клиента;
 * setServedBy отказывает при блокирующих пунктах.
 */
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { MODULE_KEYS } from "@/core/modules/registry";
import { requireTenant, tenantDirectory } from "@/core/tenant/resolve.server";
import { foreignZernioAccounts } from "@/core/tenant/zernio-accounts";
import { decryptSecret, isEncryptedSecret } from "@/core/secrets/vault";
import { evaluatePreflight, type Preflight } from "@/core/tenant/preflight";
import { telegramApi } from "@/channels/telegram/api";
import { MATERIAL_COLUMNS, productSellable, type ProductWithFiles } from "@/core/catalog/materials";
import { computeState, readPolicy } from "@/core/billing/subscription";
import { parseIdList } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";

/** Сколько id продавца в admin_chat_id: только они жмут «подтвердить». */
async function sellerChats(botId: string): Promise<number> {
  const { data } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", botId)
    .eq("key", "admin_chat_id")
    .maybeSingle();
  return parseIdList(data?.value).length;
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
  if (tokenPresent) {
    try {
      const token = decryptSecret(t.telegramTokenEnc!, env().SECRETS_KEY);
      const me = await telegramApi(token, env().TELEGRAM_API_BASE).call<{ username?: string }>(
        "getMe",
        {},
      );
      tokenOk = me.ok;
      if (me.ok && me.result?.username) botUsername = me.result.username;
    } catch {
      tokenOk = false;
    }
  }
  const [paymentMethods, products, chats, delivering, unsellable, expiresAt] = await Promise.all([
    countRows("payment_methods", botId),
    countRows("products", botId),
    sellerChats(botId),
    deliveringOrders(botId),
    unsellableProducts(botId),
    subscriptionExpiresAt(botId),
  ]);
  const policy = readPolicy(t.settings);
  return evaluatePreflight({
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
    zernioConflicts: foreignZernioAccounts(
      await tenantDirectory(),
      botId,
      t.settings.zernio?.account_ids ?? [],
    ).map((f) => f.id),
  });
}
