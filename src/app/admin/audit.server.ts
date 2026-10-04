import { serviceDb } from "@/core/db/client.server";
import type { Json } from "@/core/db-types";
import {
  ADMIN_AUDIT_ACTOR_PREFIX,
  ADMIN_AUDIT_KIND,
  auditDetails,
  shopActor,
  toAuditEntry,
  type AuditEntry,
} from "@/core/audit/admin-audit";

/**
 * Журнал действий команды магазина — в bot_events, журнале оператора.
 * Пишем и читаем под service_role: журнал принадлежит платформе, и роль
 * арендатора не должна уметь его править или стирать. bot_id берётся только
 * из проверенной сессии (adminIdentity), не из запроса.
 */
export async function recordShopAction(
  who: { botId: string; username: string },
  action: string,
  data: unknown,
): Promise<void> {
  const { error } = await serviceDb()
    .from("bot_events")
    .insert({
      bot_id: who.botId,
      actor: shopActor(who.username),
      kind: ADMIN_AUDIT_KIND,
      payload: { action, ...auditDetails(data) } as Json,
    });
  if (error) console.warn("[audit] bot_events:", error.message);
}

/** Последние действия команды магазина — для владельца. Хранится 180 дней (core/retention). */
export async function listShopActions(
  botId: string,
  limit = 200,
  who?: string,
): Promise<AuditEntry[]> {
  const q = serviceDb().from("bot_events").select("id, at, actor, payload").eq("bot_id", botId);
  // «По человеку»: один логин; без него — вся команда.
  const { data, error } = await (
    who ? q.eq("actor", shopActor(who)) : q.like("actor", `${ADMIN_AUDIT_ACTOR_PREFIX}%`)
  )
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toAuditEntry);
}
