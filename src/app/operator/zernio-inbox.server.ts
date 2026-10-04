import { serviceDb } from "@/core/db/client.server";
import { serverFailure } from "@/lib/server-failure";
import { parseZernioMessage, type ZernioWebhookMessagePayload } from "@/channels/zernio/message";
import { UNMATCHED_EVENT_TYPE } from "@/channels/zernio/intake.server";

/**
 * Входящие Instagram/WhatsApp глазами оператора: что пришло и чем кончилось
 * («магазин», «автоответчик выключен», «менеджер ведёт диалог»…). Итог
 * пишет dispatch в zernio_logs.error_message; раньше его видела только база,
 * и «бот молчит» разбирали догадками (Educational Bot, Копилка русоведа).
 */
export type InboxRow = {
  at: string;
  type: string;
  status: string;
  note: string | null;
  sender: string | null;
  text: string | null;
  account: string | null;
};

const MESSAGE_EVENTS = ["message.received", "comment.received", "message.failed"];

export function inboxRow(r: {
  created_at: string;
  event_type: string;
  status: string;
  error_message: string | null;
  payload: unknown;
}): InboxRow {
  let sender: string | null = null;
  let text: string | null = null;
  try {
    const m = parseZernioMessage(r.payload as ZernioWebhookMessagePayload);
    sender = m.senderUsername ? `@${m.senderUsername}` : m.senderName || m.senderId || null;
    text = m.text || m.postbackPayload || (m.attachments.length ? "[вложение]" : "") || null;
  } catch {
    /* событие другой формы — покажем без отправителя */
  }
  return {
    at: r.created_at,
    type: r.event_type,
    status: r.status,
    note: r.error_message,
    sender,
    text: text ? text.slice(0, 120) : null,
    account: null,
  };
}

/** Последние входящие клиента, новые сверху. */
export async function clientZernioInbox(botId: string, limit = 20): Promise<InboxRow[]> {
  const { data, error } = await serviceDb()
    .from("zernio_logs")
    .select("created_at, event_type, status, error_message, payload")
    .eq("bot_id", botId)
    .in("event_type", MESSAGE_EVENTS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw serverFailure(`zernio_logs: ${error.message}`);
  return (data ?? []).map(inboxRow);
}

/** События, дошедшие до v2 без клиента: чей аккаунт не привязан. */
export async function unmatchedZernioEvents(limit = 30): Promise<InboxRow[]> {
  const { data, error } = await serviceDb()
    .from("zernio_logs")
    .select("created_at, event_type, status, error_message, payload")
    .is("bot_id", null)
    .eq("event_type", UNMATCHED_EVENT_TYPE)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw serverFailure(`zernio_logs: ${error.message}`);
  return (data ?? []).map((r) => {
    const p = (r.payload ?? {}) as Record<string, string | null>;
    return {
      at: r.created_at,
      type: p.event ?? r.event_type,
      status: r.status,
      note: r.error_message,
      sender: p.sender ? `@${p.sender}` : null,
      text: p.text || null,
      account: [p.platform, p.account ? `@${p.account}` : null, p.accountId]
        .filter(Boolean)
        .join(" · "),
    };
  });
}
