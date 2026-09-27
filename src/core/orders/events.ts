/**
 * Таймлайн заказа — доказательство того, что произошло: создан, чек,
 * выдача каждой позиции, что не выдалось и почему. Своей таблицы у
 * журнала нет (схема заморожена до фазы 7), поэтому строки живут в
 * `zernio_logs` — единственном журнале арендатора со свободным типом и
 * jsonb-полезной нагрузкой: `event_type = order.<kind>`, `status = event`
 * (ретеншн держит такие строки 180 дней, как незавершённые), в `payload`
 * — `order_id` и детали.
 */
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";

export type OrderEventKind =
  | "placed"
  | "proof"
  | "delivery_started"
  | "item_sent"
  | "item_failed"
  | "item_pending"
  | "delivered"
  | "delivery_failed"
  | "rejected"
  | "reminded"
  | "status"
  | "notify_failed"
  | "email_sent"
  | "email_failed"
  | "payment"
  | "fulfillment_changed";

export type OrderEvent = {
  id: string;
  at: string;
  kind: OrderEventKind;
  actor: string;
  payload: Record<string, Json | undefined>;
};

export const ORDER_EVENT_STATUS = "event";

/** Запись события; сбой журнала не должен ломать сам заказ — только в консоль. */
export async function recordOrderEvent(
  ctx: TenantContext,
  orderId: number,
  kind: OrderEventKind,
  payload: Record<string, Json | undefined> = {},
  actor = "bot",
): Promise<void> {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `order:${orderId}:${kind}:${stamp}`,
    event_type: `order.${kind}`,
    status: ORDER_EVENT_STATUS,
    payload: { order_id: orderId, actor, ...payload } as Json,
  });
  if (error) console.warn(`[orders] событие ${kind} для #${orderId} не записано: ${error.message}`);
  // Модуль crm_integration: событие — во внешнюю CRM или таблицу продавца.
  if (ctx.tenant.modules.crm_integration) {
    const { queueCrmEvent } = await import("@/core/crm/webhook");
    await queueCrmEvent(ctx, kind, orderId, payload).catch((e) =>
      console.warn(`[crm] событие ${kind} для #${orderId}: ${String(e)}`),
    );
  }
}

/**
 * Событие, которое у заказа бывает один раз (например, письмо-напоминание):
 * event_id без случайной части, уникальность event_id отбивает повтор, даже
 * если два запуска крона пришли одновременно. true — событие записано этим
 * вызовом; false — оно уже было или запись не удалась (тогда действие не
 * делаем: лучше без письма, чем с двумя).
 */
export async function claimOrderEvent(
  ctx: TenantContext,
  orderId: number,
  kind: OrderEventKind,
  key: string,
  payload: Record<string, Json | undefined> = {},
  actor = "bot",
): Promise<boolean> {
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: `order:${orderId}:${kind}:${key}`,
    event_type: `order.${kind}`,
    status: ORDER_EVENT_STATUS,
    payload: { order_id: orderId, actor, ...payload } as Json,
  });
  if (error && error.code !== "23505")
    console.warn(`[orders] событие ${kind} для #${orderId} не записано: ${error.message}`);
  return !error;
}

export async function listOrderEvents(ctx: TenantContext, orderId: number): Promise<OrderEvent[]> {
  const { data } = await ctx.db
    .from("zernio_logs")
    .select("id, created_at, event_type, payload")
    .eq("status", ORDER_EVENT_STATUS)
    .like("event_type", "order.%")
    .eq("payload->>order_id", String(orderId))
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => {
    const p =
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, Json | undefined>)
        : {};
    return {
      id: r.id,
      at: r.created_at,
      kind: r.event_type.slice("order.".length) as OrderEventKind,
      actor: typeof p.actor === "string" ? p.actor : "bot",
      payload: p,
    };
  });
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const num = (v: Json | undefined) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** Текст события для карточки заказа. */
export function describeOrderEvent(e: Pick<OrderEvent, "kind" | "actor" | "payload">): {
  text: string;
  tone: "neutral" | "ok" | "warn" | "danger";
} {
  const p = e.payload;
  const who = e.actor.startsWith("admin")
    ? ` (${e.actor.slice("admin:".length) || "продавец"})`
    : e.actor === "system"
      ? " (система)"
      : "";
  switch (e.kind) {
    case "placed":
      return p.platform === "manual"
        ? { text: `Заказ заведён вручную${who}`, tone: "neutral" }
        : { text: `Заказ создан${p.platform ? ` · ${str(p.platform)}` : ""}`, tone: "neutral" };
    case "payment":
      return {
        text: `Внесено ${num(p.amount)}${p.currency ? ` ${str(p.currency)}` : ""}${p.source === "deposit" ? " (задаток по чеку)" : ""}${who}`,
        tone: "ok",
      };
    case "fulfillment_changed":
      return { text: `Получение изменено${who}`, tone: "neutral" };
    case "proof":
      return { text: "Чек получен", tone: "neutral" };
    case "delivery_started":
      return { text: `Выдача начата${who}`, tone: "neutral" };
    case "item_sent":
      return {
        text: `Выдано: ${str(p.name)}${p.lang ? ` (${str(p.lang)})` : ""}`,
        tone: "ok",
      };
    case "item_failed":
      return {
        text: `Не выдалось: ${str(p.name)}${p.reason ? ` — ${str(p.reason)}` : ""}`,
        tone: "danger",
      };
    case "item_pending":
      return { text: `Покупателю задан вопрос о языке: ${str(p.name)}`, tone: "warn" };
    case "delivered":
      return { text: `Заказ выдан полностью (${num(p.sent)} поз.)`, tone: "ok" };
    case "delivery_failed":
      return {
        text: `Выдача не завершена: не удалось ${num(p.failed)} из ${num(p.total)}`,
        tone: "danger",
      };
    case "rejected":
      return { text: `Заказ отклонён${who}`, tone: "danger" };
    case "reminded":
      return p.channel === "email"
        ? { text: `Напоминание об оплате — письмом на ${str(p.to)}`, tone: "neutral" }
        : { text: `Напоминание об оплате отправлено${who}`, tone: "neutral" };
    case "status":
      return { text: `Статус: ${str(p.to)}${who}`, tone: "neutral" };
    case "email_sent":
      return {
        text: `Материалы отправлены на почту ${str(p.to)} (${num(p.files)} ссылок)`,
        tone: "ok",
      };
    case "email_failed":
      return { text: `Письмо на ${str(p.to)} не ушло: ${str(p.error)}`, tone: "warn" };
    case "notify_failed":
      return p.retrying
        ? { text: `Сообщение покупателю не ушло, повторим: ${str(p.text)}`, tone: "warn" }
        : { text: `Сообщение покупателю не доставлено: ${str(p.text)}`, tone: "warn" };
    default:
      return { text: String(e.kind), tone: "neutral" };
  }
}
