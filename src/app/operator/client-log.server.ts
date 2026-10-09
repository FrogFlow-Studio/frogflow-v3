import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import { scrubForLog } from "@/lib/log-mask";

/** Журнал событий клиента для оператора. */

type EventKind =
  | "module_on"
  | "module_off"
  | "pause"
  | "resume"
  | "suspend"
  | "onboard"
  | "webhook"
  | "meta"
  | "message"
  | "payment";

export async function logEvent(
  botId: string,
  kind: EventKind,
  payload: Record<string, unknown> = {},
  actor = "operator",
): Promise<void> {
  const { error } = await serviceDb()
    .from("bot_events")
    .insert({ bot_id: botId, actor, kind, payload: scrubForLog(payload) as Json });
  if (error) console.warn("[operator] bot_events:", error.message);
}
