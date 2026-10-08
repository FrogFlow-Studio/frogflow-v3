import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Метка «это входящее уже обрабатывается» — одна на сообщение Zernio, кто
 * бы его ни принёс: вебхук или опрос ящика (inbox-poll.server). У вебхука
 * и опроса разные event_id (у опроса своего события нет), поэтому журнал
 * событий их не разводит; разводит эта строка. Своей таблицы нет (схема
 * заморожена) — строка в `zernio_logs` с уникальным
 * `event_id = zmsg:<bot_id>:<id сообщения>`, как метка обновления Telegram
 * (channels/telegram/dedupe). Вставка — условная запись: из вебхука и
 * опроса, пришедших одновременно, проходит ровно один.
 *
 * Повтор того же события (добор зависших, dispatch.server) метку не
 * теряет: в строке записано, чьё она, и своё событие проходит снова.
 */
export const MESSAGE_CLAIM_EVENT = "zernio.message_claim";

export function messageClaimEventId(botId: string, key: string): string {
  return `zmsg:${botId}:${key}`.slice(0, 250);
}

/**
 * won — сообщение наше, обрабатываем; lost — его уже взял другой путь;
 * unknown — база не ответила (решает вызывающий: вебхук отвечает, опрос нет).
 */
export type MessageClaim = "won" | "lost" | "unknown";

export async function claimZernioMessage(
  ctx: TenantContext,
  key: string,
  by: string,
  conversationId: string,
): Promise<MessageClaim> {
  const eventId = messageClaimEventId(ctx.tenant.id, key);
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: eventId,
    event_type: MESSAGE_CLAIM_EVENT,
    status: "processed",
    payload: { by, conversation_id: conversationId },
  });
  if (!error) return "won";
  if (error.code !== "23505" && !/duplicate|unique/i.test(error.message)) {
    console.error(`[zernio:${ctx.tenant.id}] метка сообщения ${key} не записалась`, error.message);
    return "unknown";
  }
  // Строка уже есть: наша (повтор того же события) или чужая.
  const { data, error: readErr } = await ctx.db
    .from("zernio_logs")
    .select("payload")
    .eq("event_id", eventId)
    .maybeSingle();
  if (readErr) {
    console.error(`[zernio:${ctx.tenant.id}] метка сообщения ${key} не прочитана`, readErr.message);
    return "unknown";
  }
  const owner = (data?.payload as { by?: unknown } | null)?.by;
  return owner === by ? "won" : "lost";
}

/**
 * Метка на все ключи сообщения (zernioMessageKeys): id Meta и id Zernio.
 * Любой ключ уже чужой — lost (другой путь взял сообщение по общему id);
 * сбой базы на любом — unknown. Свои строки от прежнего прохода того же
 * события проходят снова (claimZernioMessage).
 */
export async function claimZernioMessageKeys(
  ctx: TenantContext,
  keys: readonly string[],
  by: string,
  conversationId: string,
): Promise<MessageClaim> {
  let unknown = false;
  for (const key of keys) {
    const claim = await claimZernioMessage(ctx, key, by, conversationId);
    if (claim === "lost") return "lost";
    if (claim === "unknown") unknown = true;
  }
  return unknown ? "unknown" : "won";
}
