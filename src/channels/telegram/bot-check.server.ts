import { env } from "@/config/env";
import { telegramApi, type TelegramApi } from "./api";
import { telegramWebhookUrl } from "./secret";
import { tenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { servedByV2 } from "@/core/tenant/directory";
import { botCommandNames, botCommandsVersion } from "./commands";
import { sellsNowOrShop } from "@/core/tenant/sells.server";
import { allowedUpdatesFor } from "./webhook-setup.server";
import type { BotCheck, CheckItem, InstallError } from "./bot-check";

/**
 * «Проверить бота» в настройках Telegram: токен жив, вебхук смотрит на нас и
 * без ошибок, нужные типы обновлений включены, меню команд поставлено. Только
 * чтение (getMe, getWebhookInfo, getMyCommands); чинит отдельная кнопка —
 * существующая установка вебхука и команд (reinstallWebhook).
 */

/** Общий бюджет проверки: функция сервера живёт до 120 с, остальное — запас на починку. */
export const CHECK_BUDGET_MS = 60_000;
/** Ошибка доставки в getWebhookInfo старше этого — уже не про сейчас. */
export const WEBHOOK_ERROR_FRESH_S = 3600;

const unknownItems = (codes: Array<CheckItem["key"]>): CheckItem[] =>
  codes.map((key) => ({ key, status: "unknown", code: "late" }));

/** Хост из адреса вебхука: путь и параметры чужого вебхука продавцу не показываем. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

export async function checkBot(
  tenant: Tenant,
  opts: { now?: () => number; api?: TelegramApi } = {},
): Promise<BotCheck> {
  if (!servedByV2(tenant)) return { skipped: "not_v2", items: [], ok: false };
  if (!tenant.telegramTokenEnc) return { skipped: "no_token", items: [], ok: false };
  const now = opts.now ?? Date.now;
  const started = now();
  const late = () => now() - started > CHECK_BUDGET_MS;
  const { APP_URL, TELEGRAM_API_BASE } = env();
  const api =
    opts.api ?? telegramApi(tenantContext(tenant).secrets.telegramToken(), TELEGRAM_API_BASE);
  const items: CheckItem[] = [];

  const me = await api.call<{ username?: string }>("getMe");
  if (!me.ok) {
    // 401/404 — Telegram сам сказал, что такого токена нет; иначе просто не ответил.
    const dead = me.error_code === 401 || me.error_code === 404;
    items.push({
      key: "token",
      status: dead ? "fail" : "unknown",
      code: dead ? "dead" : "noReply",
    });
    // Без живого токена остальное проверить нечем.
    items.push(...unknownItems(["webhook", "updates", "commands"]));
    return { items, ok: false };
  }
  items.push({
    key: "token",
    status: "ok",
    code: "ok",
    params: { username: me.result?.username ?? "" },
  });

  if (late()) {
    items.push(...unknownItems(["webhook", "updates", "commands"]));
    return { items, ok: false };
  }
  const info = await api.call<{
    url?: string;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    allowed_updates?: string[];
  }>("getWebhookInfo");
  if (!info.ok) {
    items.push({ key: "webhook", status: "unknown", code: "noReply" });
    items.push({ key: "updates", status: "unknown", code: "noReply" });
  } else {
    const r = info.result ?? {};
    const want = telegramWebhookUrl(APP_URL, tenant.id);
    const pending = r.pending_update_count ?? 0;
    const freshError =
      r.last_error_message &&
      r.last_error_date &&
      now() / 1000 - r.last_error_date < WEBHOOK_ERROR_FRESH_S;
    if (!r.url) items.push({ key: "webhook", status: "fail", code: "none" });
    else if (r.url !== want)
      items.push({
        key: "webhook",
        status: "fail",
        code: "foreign",
        params: { host: hostOf(r.url) },
      });
    else if (freshError)
      items.push({
        key: "webhook",
        status: "fail",
        code: "error",
        params: { error: r.last_error_message!.slice(0, 200), pending },
      });
    else items.push({ key: "webhook", status: "ok", code: "ok", params: { pending } });

    // Список событий смотрим, только когда вебхук наш: у чужого он ничего не значит.
    if (r.url === want) {
      const have = new Set(r.allowed_updates ?? ["message", "callback_query"]);
      const missing = allowedUpdatesFor(tenant).filter((u) => !have.has(u));
      items.push(
        missing.length
          ? {
              key: "updates",
              status: "fail",
              code: "missing",
              params: { list: missing.join(", ") },
            }
          : { key: "updates", status: "ok", code: "ok" },
      );
    } else items.push({ key: "updates", status: "unknown", code: "needWebhook" });
  }

  if (late()) {
    items.push(...unknownItems(["commands"]));
  } else {
    const cmds = await api.call<Array<{ command: string }>>("getMyCommands", {});
    if (!cmds.ok) items.push({ key: "commands", status: "unknown", code: "noReply" });
    else {
      const have = (cmds.result ?? []).map((c) => c.command).join(",");
      // Консультант без товаров — без /catalog, /cart, /orders (как ставит webhook-setup).
      const sells = await sellsNowOrShop(tenantContext(tenant));
      const want = botCommandNames(tenant, sells).join(",");
      if (!have) items.push({ key: "commands", status: "fail", code: "none" });
      else if (
        have !== want ||
        tenant.settings.telegram?.commands_v !== botCommandsVersion(tenant, sells)
      )
        items.push({ key: "commands", status: "fail", code: "stale" });
      else items.push({ key: "commands", status: "ok", code: "ok" });
    }
  }
  return { items, ok: items.every((i) => i.status === "ok") };
}

/**
 * «Починить»: ровно одна существующая установка вебхука и команд
 * (reinstallWebhook пишет в журнал клиента), потом проверка заново по свежим
 * настройкам. Сбой установки возвращается вместе с проверкой, чтобы продавец
 * видел, что осталось сломанным.
 */
export async function repairBot(
  tenantId: string,
  actor = "admin",
): Promise<{ check: BotCheck; installError?: InstallError }> {
  const { reinstallWebhook } = await import("@/app/operator/operator.server");
  const { requireTenant } = await import("@/core/tenant/resolve.server");
  const before = await requireTenant({ by: "id", value: tenantId });
  if (!servedByV2(before) || !before.telegramTokenEnc) return { check: await checkBot(before) };
  let installError: InstallError | undefined;
  try {
    const r = await reinstallWebhook(tenantId, actor);
    if (!r.ok)
      installError = r.error
        ? { code: "telegram", reason: r.error.slice(0, 200) }
        : { code: "unknown" };
  } catch (e) {
    console.warn(`[bot-check:${tenantId}] установка вебхука:`, e);
    installError = { code: "unknown" };
  }
  const after = await requireTenant({ by: "id", value: tenantId });
  return { check: await checkBot(after), ...(installError ? { installError } : {}) };
}
