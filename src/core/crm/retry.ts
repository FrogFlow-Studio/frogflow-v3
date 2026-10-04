import type { TenantContext } from "@/core/tenant/resolve.server";
import { OUTBOX_PREFIX, retryOutbox } from "@/core/outbox/outbox";
import { serverFailure } from "@/lib/server-failure";

/**
 * Ручной повтор вебхука из журнала доставки. Берётся та же строка очереди:
 * тело и `event_id` прежние, CRM может отбросить дубль. Повторить можно
 * только событие вебхука этого магазина, которое сдалось («не доставлено»);
 * чужая или другого вида строка — «не найдено».
 */
export async function retryCrmEvent(
  ctx: TenantContext,
  outboxId: string,
): Promise<"queued" | "not_found"> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("id, status")
    .eq("id", outboxId)
    .eq("event_type", "outbox.crm_webhook")
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .maybeSingle();
  if (error) throw serverFailure(`Повтор вебхука: ${error.message}`);
  if (!data || data.status !== "dead") return "not_found";
  return (await retryOutbox(ctx, outboxId)) ? "queued" : "not_found";
}
