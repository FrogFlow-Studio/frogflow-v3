import { createHmac } from "node:crypto";
import { timingSafeSecretEqual } from "@/lib/safe-equal";

/**
 * Секрет вебхука Telegram для конкретного бота.
 *
 * Telegram при setWebhook принимает `secret_token` и присылает его в
 * заголовке X-Telegram-Bot-Api-Secret-Token с каждым обновлением. В v1 это
 * была переменная TELEGRAM_WEBHOOK_SECRET на каждом деплое. В v2 деплой один,
 * а ботов много, и хранить по секрету на бота незачем: секрет выводится из
 * bot_id и одного секрета платформы. Ничего не хранится, ничего не
 * ротируется по одному, а подделать заголовок без WEBHOOK_SECRET нельзя.
 *
 * Telegram ограничивает secret_token 256 символами [A-Za-z0-9_-]; hex
 * HMAC-SHA256 — 64 символа, укладывается.
 */
export function telegramWebhookSecret(botId: string, platformSecret: string): string {
  return createHmac("sha256", platformSecret).update(`telegram:${botId}`).digest("hex");
}

export function verifyTelegramWebhookHeader(
  header: string | null,
  botId: string,
  platformSecret: string,
): boolean {
  if (!header) return false;
  return timingSafeSecretEqual(header, telegramWebhookSecret(botId, platformSecret));
}

/** Адрес вебхука бота на этом деплое. */
export function telegramWebhookUrl(appUrl: string, botId: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/telegram/${botId}`;
}
