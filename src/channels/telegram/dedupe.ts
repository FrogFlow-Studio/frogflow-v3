/**
 * Повторная доставка обновлений Telegram. Если вебхук не ответил вовремя
 * (долгая выдача, LLM-поиск, холодный старт) или платформа вернула 5xx,
 * Telegram шлёт то же обновление ещё раз — и покупатель получал второй
 * ответ, второй заказ, вторую выдачу. Своей таблицы нет (схема заморожена),
 * поэтому метка «уже принято» — строка в `zernio_logs` с уникальным
 * `event_id = tg:<bot_id>:<update_id>` (у VIP-бота `tgvip:`), как дедупликация
 * событий Zernio.
 * Строка пишется сразу `processed`: повтор для Telegram не нужен, а
 * ретеншн уберёт её через 30 дней.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";

export const TELEGRAM_UPDATE_EVENT = "telegram.update";

/** Второй бот клиента (VIP) нумерует обновления сам — у него свой ряд ключей. */
export type TelegramBotKind = "shop" | "vip";

export function telegramUpdateEventId(
  botId: string,
  updateId: number,
  kind: TelegramBotKind = "shop",
): string {
  return `${kind === "vip" ? "tgvip" : "tg"}:${botId}:${updateId}`;
}

/**
 * true — обновление новое, его надо обработать; false — повтор. Без
 * update_id или при сбое базы обрабатываем: лишний ответ лучше молчания.
 */
export async function claimTelegramUpdate(
  ctx: TenantContext,
  updateId: number | undefined,
  kind: TelegramBotKind = "shop",
): Promise<boolean> {
  if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) return true;
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: telegramUpdateEventId(ctx.tenant.id, updateId, kind),
    event_type: TELEGRAM_UPDATE_EVENT,
    status: "processed",
    payload: { update_id: updateId, bot: kind },
  });
  if (!error) return true;
  if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
    console.warn(`[tg:${ctx.tenant.id}] update ${updateId} пришёл повторно — пропускаем`);
    return false;
  }
  console.error(`[tg:${ctx.tenant.id}] метка обновления ${updateId} не записалась`, error.message);
  return true;
}
