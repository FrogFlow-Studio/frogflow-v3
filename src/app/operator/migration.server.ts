/**
 * Предполётная проверка перед переводом клиента на v2: собирает входные
 * данные (токен через getMe, реквизиты, товары, логин продавца) и отдаёт
 * вердикт из core/tenant/preflight. Оператор видит его в карточке клиента;
 * setServedBy отказывает при блокирующих пунктах.
 */
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { MODULE_KEYS } from "@/core/modules/registry";
import { requireTenant } from "@/core/tenant/resolve.server";
import { decryptSecret, isEncryptedSecret } from "@/core/secrets/vault";
import { evaluatePreflight, type Preflight } from "@/core/tenant/preflight";
import { telegramApi } from "@/channels/telegram/api";

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
  const [paymentMethods, products] = await Promise.all([
    countRows("payment_methods", botId),
    countRows("products", botId),
  ]);
  return evaluatePreflight({
    modulesOn: MODULE_KEYS.filter((k) => t.modules[k]),
    tokenPresent,
    tokenOk,
    botUsername,
    paymentMethods,
    products,
    adminLogin: Boolean(t.settings.admin?.username && t.settings.admin?.password_hash),
    appUrl: t.appUrl,
  });
}
