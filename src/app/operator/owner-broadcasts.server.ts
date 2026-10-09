import { serviceDb } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { NO_RECIPIENTS_REASON } from "@/core/notify/deliver";
import { serverFailure } from "@/lib/server-failure";
import { toJson } from "@/core/json";
import { notifyOwner } from "./owner-messages.server";

/** Рассылки оператора владельцам магазинов. */

/* ── рассылка владельцам магазинов ────────────────────────────────── */

export type OwnerDelivery = {
  bot_id: string;
  bot_name: string;
  status: "sent" | "failed" | "skipped";
  error?: string;
  at: string;
};

/**
 * Одно сообщение сразу всем (или выбранным) владельцам — через их же ботов.
 * Параллельно: общее время равно самому медленному, а не сумме. Отчёт по
 * каждому клиенту сохраняется в operator_broadcasts, а notifyOwner пишет
 * событие «message» в журнал клиента.
 */
export async function broadcastToOwners(
  botIds: string[],
  text: string,
  actor = "operator",
): Promise<{ id: string; results: OwnerDelivery[] }> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Пустое сообщение.");
  const tenants = await tenantDirectory(true);
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const now = () => new Date().toISOString();
  const results = await Promise.all(
    botIds.map(async (id): Promise<OwnerDelivery> => {
      const t = byId.get(id);
      if (!t)
        return {
          bot_id: id,
          bot_name: "—",
          status: "skipped",
          error: "Клиент не найден",
          at: now(),
        };
      if (!t.telegramTokenEnc)
        return {
          bot_id: id,
          bot_name: t.name,
          status: "skipped",
          error: "Нет Telegram-бота",
          at: now(),
        };
      try {
        const r = await notifyOwner(id, trimmed);
        if (r.delivered.length > 0)
          return { bot_id: id, bot_name: t.name, status: "sent", at: now() };
        return {
          bot_id: id,
          bot_name: t.name,
          status: "failed",
          error: r.failed[0]?.reason ?? NO_RECIPIENTS_REASON,
          at: now(),
        };
      } catch (e) {
        return {
          bot_id: id,
          bot_name: t.name,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
          at: now(),
        };
      }
    }),
  );
  const { data, error } = await serviceDb()
    .from("operator_broadcasts")
    .insert({
      actor,
      message_text: trimmed,
      target: botIds.length === tenants.filter((t) => !t.archived).length ? "all" : "selected",
      results: toJson(results),
    })
    .select("id")
    .single();
  if (error) console.error("[operator] operator_broadcasts insert:", error.message);
  return { id: data?.id ?? "", results };
}

export type OwnerBroadcastView = {
  id: string;
  created_at: string;
  actor: string;
  message_text: string;
  target: string;
  results: OwnerDelivery[];
};

export async function listOwnerBroadcasts(limit = 20): Promise<OwnerBroadcastView[]> {
  const { data, error } = await serviceDb()
    .from("operator_broadcasts")
    .select("id, created_at, actor, message_text, target, results")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw serverFailure(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    results: Array.isArray(r.results) ? (r.results as unknown as OwnerDelivery[]) : [],
  }));
}
