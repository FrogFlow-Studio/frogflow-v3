/**
 * Outbox — очередь исходящих одного арендатора. Сообщение покупателю или
 * продавцу сначала отправляется сразу; не вышло — ложится в журнал и крон
 * повторяет с растущей паузой (core/outbox/pure.ts). Своей таблицы нет
 * (схема заморожена), поэтому строки живут в `zernio_logs`:
 * `event_type = outbox.<kind>`, `event_id = outbox:<uuid>`, `status`:
 * `queued` — ждёт, `processed` — доставлено (ретеншн уберёт через 30
 * дней), `dead` — попытки кончились, продавец видит в «Не доставлено»,
 * `ignored` — продавец скрыл. В payload — адресат, текст, попытки и
 * `next_at`; отправители по каналам — в app/outbox (ядро канала не знает).
 */
import { randomUUID } from "node:crypto";
import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { outboxNextAt, outboxPermanentFailure } from "./pure";

export type OutboxTarget =
  /** Адресат — заказ целиком (повтор выдачи): канал берётся из заказа. */
  | { channel: "order" }
  | { channel: "telegram"; chatId: string }
  | {
      channel: "zernio";
      conversationId: string;
      accountId: string;
      platform: "instagram" | "whatsapp";
      phone?: string | null;
    };

export type OutboxMessage = {
  /** Что это: customer_notice, admin_notice, deliver_order… — для страницы и таймлайна. */
  kind: string;
  target: OutboxTarget;
  /** Текст (HTML для Telegram; Zernio снимает разметку сам). Пусто у deliver_order. */
  text?: string;
  orderId?: number;
  /** Кто адресат для страницы: «покупатель» или «продавец». */
  audience: "customer" | "admin";
};

export type OutboxRow = OutboxMessage & {
  id: string;
  eventId: string;
  status: "queued" | "sending" | "dead" | "processed" | "ignored";
  attempts: number;
  nextAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export type OutboxSender = (
  ctx: TenantContext,
  msg: OutboxMessage,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export const OUTBOX_PREFIX = "outbox:";
const TYPE = (kind: string) => `outbox.${kind}`;

type Payload = {
  target: OutboxTarget;
  text?: string;
  order_id?: number;
  audience: OutboxMessage["audience"];
  attempts: number;
  next_at: string | null;
  last_error: string | null;
};

export async function enqueueOutbox(
  ctx: TenantContext,
  msg: OutboxMessage,
  firstError: string | null,
  now = new Date(),
): Promise<string> {
  const attempts = firstError ? 1 : 0;
  const nextAt = firstError ? outboxNextAt(attempts, now) : now;
  const dead = nextAt === null || outboxPermanentFailure(firstError);
  const eventId = `${OUTBOX_PREFIX}${randomUUID()}`;
  const payload: Payload = {
    target: msg.target,
    text: msg.text,
    order_id: msg.orderId,
    audience: msg.audience,
    attempts,
    next_at: dead ? null : nextAt!.toISOString(),
    last_error: firstError,
  };
  const { error } = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: eventId,
    event_type: TYPE(msg.kind),
    status: dead ? "dead" : "queued",
    payload: payload as unknown as Json,
    error_message: firstError,
  });
  if (error) console.warn(`[outbox] не поставлено в очередь (${msg.kind}): ${error.message}`);
  if (dead && msg.orderId) await noteDead(ctx, msg, firstError);
  return eventId;
}

/**
 * Отправить сейчас, при отказе — в очередь. Возвращает, ушло ли сразу:
 * вызывающему коду это нужно только для сообщения «отправлено» в интерфейсе,
 * доставку дальше обеспечивает крон.
 */
export async function sendOrEnqueue(
  ctx: TenantContext,
  msg: OutboxMessage,
  send: OutboxSender,
): Promise<boolean> {
  let error: string;
  try {
    const r = await send(ctx, msg);
    if (r.ok) return true;
    error = r.error;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  await enqueueOutbox(ctx, msg, error || "отказ без причины");
  return false;
}

function rowOf(r: {
  id: string;
  event_id: string | null;
  event_type: string;
  status: string;
  payload: Json;
  created_at: string;
}): OutboxRow {
  const p = (r.payload ?? {}) as unknown as Partial<Payload>;
  return {
    id: r.id,
    eventId: r.event_id ?? "",
    kind: r.event_type.replace(/^outbox\./, ""),
    target: p.target ?? { channel: "telegram", chatId: "" },
    text: p.text,
    orderId: p.order_id,
    audience: p.audience ?? "customer",
    status: r.status as OutboxRow["status"],
    attempts: p.attempts ?? 0,
    nextAt: p.next_at ?? null,
    lastError: p.last_error ?? null,
    createdAt: r.created_at,
  };
}

const SELECT = "id, event_id, event_type, status, payload, created_at";

/** Что ждёт повтора прямо сейчас — порция на один запуск крона. */
export async function dueOutbox(ctx: TenantContext, now = new Date(), limit = 50) {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .eq("status", "queued")
    .lte("payload->>next_at", now.toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`outbox: ${error.message}`);
  return (data ?? []).map(rowOf);
}

export type ProcessResult = { tried: number; sent: number; dead: number; requeued: number };

export async function processOutbox(
  ctx: TenantContext,
  send: OutboxSender,
  now = new Date(),
): Promise<ProcessResult> {
  const res: ProcessResult = { tried: 0, sent: 0, dead: 0, requeued: 0 };
  for (const row of await dueOutbox(ctx, now)) {
    res.tried++;
    // Забираем строку себе: второй запуск крона в ту же минуту её не возьмёт.
    const { data: claimed } = await ctx.db
      .from("zernio_logs")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;
    let error: string | null = null;
    try {
      const r = await send(ctx, row);
      if (!r.ok) error = r.error || "отказ без причины";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const attempts = row.attempts + 1;
    const nextAt = error ? outboxNextAt(attempts, now) : null;
    const dead = Boolean(error) && (nextAt === null || outboxPermanentFailure(error));
    const status = !error ? "processed" : dead ? "dead" : "queued";
    await ctx.db
      .from("zernio_logs")
      .update({
        status,
        error_message: error,
        payload: {
          target: row.target,
          text: row.text,
          order_id: row.orderId,
          audience: row.audience,
          attempts,
          next_at: status === "queued" ? nextAt!.toISOString() : null,
          last_error: error,
        } as unknown as Json,
      })
      .eq("id", row.id);
    if (!error) res.sent++;
    else if (dead) {
      res.dead++;
      if (row.orderId) await noteDead(ctx, row, error);
    } else res.requeued++;
  }
  return res;
}

async function noteDead(ctx: TenantContext, msg: OutboxMessage, error: string | null) {
  const { recordOrderEvent } = await import("@/core/orders/events");
  await recordOrderEvent(
    ctx,
    msg.orderId!,
    msg.kind === "deliver_order" ? "delivery_failed" : "notify_failed",
    { text: (msg.text ?? "").slice(0, 120), error: error ?? undefined, outbox: true },
    "outbox",
  );
}

/** Для страницы «Не доставлено»: ждущие повтора и оставленные попытки. */
export async function listUndelivered(ctx: TenantContext, limit = 200): Promise<OutboxRow[]> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .in("status", ["queued", "dead", "sending"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`outbox: ${error.message}`);
  return (data ?? []).map(rowOf);
}

export async function countUndelivered(ctx: TenantContext): Promise<number> {
  const { count } = await ctx.db
    .from("zernio_logs")
    .select("id", { count: "exact", head: true })
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .eq("status", "dead");
  return count ?? 0;
}

/** Продавец нажал «повторить»: попытки обнуляются, крон возьмёт в ближайшую минуту. */
export async function retryOutbox(ctx: TenantContext, id: string, now = new Date()) {
  const { data } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .eq("id", id)
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .maybeSingle();
  if (!data) return false;
  const row = rowOf(data);
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({
      status: "queued",
      payload: {
        target: row.target,
        text: row.text,
        order_id: row.orderId,
        audience: row.audience,
        attempts: 0,
        next_at: now.toISOString(),
        last_error: row.lastError,
      } as unknown as Json,
    })
    .eq("id", id);
  return !error;
}

export async function dismissOutbox(ctx: TenantContext, id: string) {
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({ status: "ignored" })
    .eq("id", id)
    .like("event_id", `${OUTBOX_PREFIX}%`);
  return !error;
}
