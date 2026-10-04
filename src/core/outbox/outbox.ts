import { serverFailure } from "@/lib/server-failure";
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
import { fromJson, toJson } from "@/core/json";

export type OutboxTarget =
  /** Адресат — заказ целиком (повтор выдачи): канал берётся из заказа. */
  | { channel: "order" }
  | { channel: "telegram"; chatId: string }
  /** Вебхук продавца (модуль crm_integration): text — JSON-тело. */
  | { channel: "webhook"; url: string }
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
  /**
   * `outbox:<uuid>` — id строки очереди. Выдаётся до первой отправки
   * (sendOrEnqueue) и не меняется между попытками: канал строит из него
   * ключ идемпотентности, и повтор после таймаута не удваивает сообщение.
   */
  eventId?: string;
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

/**
 * Отказ отправителя. Канал сам решает по коду ответа, повторять ли:
 * `permanent` — адресат недостижим, повтор не поможет; `retryAfterSec` —
 * упёрлись в лимит: ждём столько (от минуты до часа) и пробуем снова,
 * попытку не тратим; `recipientOnly` — лимит на одного получателя, прочим
 * писать можно. Без полей — решает текст (Telegram) и счётчик попыток.
 */
export type OutboxFailure = {
  error: string;
  permanent?: boolean;
  retryAfterSec?: number;
  recipientOnly?: boolean;
};

export type OutboxSender = (
  ctx: TenantContext,
  msg: OutboxMessage,
) => Promise<{ ok: true } | ({ ok: false } & OutboxFailure)>;

/** Лимит не тратит попытки, но ждём не больше часа за раз и не дольше суток от постановки. */
const RATE_LIMITED_MAX_AGE_MS = 24 * 60 * 60_000;
const RATE_LIMITED_MIN_WAIT_SEC = 60;
const RATE_LIMITED_MAX_WAIT_SEC = 60 * 60;

function failureOf(f: string | OutboxFailure | null): OutboxFailure | null {
  return typeof f === "string" ? { error: f } : f;
}

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
  first: string | OutboxFailure | null,
  now = new Date(),
): Promise<string> {
  const failure = failureOf(first);
  const firstError = failure?.error ?? null;
  const limited = failure?.retryAfterSec !== undefined;
  const attempts = failure && !limited ? 1 : 0;
  const nextAt = limited
    ? rateLimitedNextAt(failure!.retryAfterSec!, now, now)
    : failure
      ? outboxNextAt(attempts, now)
      : now;
  const dead = nextAt === null || Boolean(failure?.permanent) || outboxPermanentFailure(firstError);
  const eventId = msg.eventId ?? newOutboxId();
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
    payload: toJson(payload),
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
  msg = { ...msg, eventId: msg.eventId ?? newOutboxId() };
  let failure: OutboxFailure;
  try {
    const r = await send(ctx, msg);
    if (r.ok) return true;
    failure = { ...r, error: r.error || "отказ без причины" };
  } catch (e) {
    failure = { error: e instanceof Error ? e.message : String(e) };
  }
  await enqueueOutbox(ctx, msg, failure);
  return false;
}

const newOutboxId = () => `${OUTBOX_PREFIX}${randomUUID()}`;

/** Когда пробовать после лимита; null — за сутки от постановки не успеть. */
function rateLimitedNextAt(retryAfterSec: number, now: Date, createdAt: Date): Date | null {
  const wait = Math.min(
    Math.max(retryAfterSec, RATE_LIMITED_MIN_WAIT_SEC),
    RATE_LIMITED_MAX_WAIT_SEC,
  );
  const next = new Date(now.getTime() + wait * 1000);
  return next.getTime() > createdAt.getTime() + RATE_LIMITED_MAX_AGE_MS ? null : next;
}

/** Получатель сообщения — чтобы лимит одного не тормозил остальных. */
function recipientKey(t: OutboxTarget): string {
  switch (t.channel) {
    case "zernio":
      return `zernio:${t.conversationId}`;
    case "telegram":
      return `telegram:${t.chatId}`;
    case "webhook":
      return `webhook:${t.url}`;
    default:
      return t.channel;
  }
}

function rowOf(r: {
  id: string;
  event_id: string | null;
  event_type: string;
  status: string;
  payload: Json;
  created_at: string;
}): OutboxRow {
  const p = fromJson<Partial<Payload>>(r.payload ?? {});
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
  if (error) throw serverFailure(`outbox: ${error.message}`);
  return (data ?? []).map(rowOf);
}

export type ProcessResult = { tried: number; sent: number; dead: number; requeued: number };

export async function processOutbox(
  ctx: TenantContext,
  send: OutboxSender,
  now = new Date(),
): Promise<ProcessResult> {
  const res: ProcessResult = { tried: 0, sent: 0, dead: 0, requeued: 0 };
  // Получатели под лимитом (131056): их сообщения ждут, остальные уходят.
  const limitedRecipients = new Set<string>();
  for (const row of await dueOutbox(ctx, now)) {
    if (limitedRecipients.has(recipientKey(row.target))) continue;
    res.tried++;
    // Забираем строку себе: второй запуск крона в ту же минуту её не возьмёт.
    const { data: claimed, error: claimedError } = await ctx.db
      .from("zernio_logs")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (claimedError) throw serverFailure(`Очередь отправки: ${claimedError.message}`);
    if (!claimed?.length) continue;
    let failure: OutboxFailure | null = null;
    try {
      const r = await send(ctx, row);
      if (!r.ok) failure = { ...r, error: r.error || "отказ без причины" };
    } catch (e) {
      failure = { error: e instanceof Error ? e.message : String(e) };
    }
    const error = failure?.error ?? null;
    // Лимит: попытку не тратим, ждём сколько сказали (в пределах часа и
    // суток от постановки). Лимит ключа (429) общий на всех клиентов —
    // остаток очереди в следующий прогон; лимит получателя — только его.
    const limited = failure?.retryAfterSec !== undefined;
    const attempts = limited ? row.attempts : row.attempts + 1;
    const created = new Date(Date.parse(row.createdAt) || now.getTime());
    const nextAt = limited
      ? rateLimitedNextAt(failure!.retryAfterSec!, now, created)
      : error
        ? outboxNextAt(attempts, now)
        : null;
    const dead =
      Boolean(error) &&
      (nextAt === null || Boolean(failure?.permanent) || outboxPermanentFailure(error));
    const status = !error ? "processed" : dead ? "dead" : "queued";
    const settled = await ctx.db
      .from("zernio_logs")
      .update({
        status,
        error_message: error,
        payload: toJson({
          target: row.target,
          text: row.text,
          order_id: row.orderId,
          audience: row.audience,
          attempts,
          next_at: status === "queued" ? nextAt!.toISOString() : null,
          last_error: error,
        }),
      })
      .eq("id", row.id);
    // Итог не записался: строка остаётся в «sending», крон её не берёт, продавец видит её
    // среди недоставленных; в логе — причина.
    if (settled.error)
      console.error(`[outbox] итог строки ${row.id} не записан: ${settled.error.message}`);
    if (!error) res.sent++;
    else if (dead) {
      res.dead++;
      if (row.orderId) await noteDead(ctx, row, error);
    } else res.requeued++;
    if (limited && failure?.recipientOnly) limitedRecipients.add(recipientKey(row.target));
    else if (limited) break;
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
  if (error) throw serverFailure(`outbox: ${error.message}`);
  return (data ?? []).map(rowOf);
}

export async function countUndelivered(ctx: TenantContext): Promise<number> {
  const { count, error: countError } = await ctx.db
    .from("zernio_logs")
    .select("id", { count: "exact", head: true })
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .eq("status", "dead");
  if (countError) throw serverFailure(`Очередь отправки: ${countError.message}`);
  return count ?? 0;
}

/** Продавец нажал «повторить»: попытки обнуляются, крон возьмёт в ближайшую минуту. */
export async function retryOutbox(ctx: TenantContext, id: string, now = new Date()) {
  const { data, error: dataError } = await ctx.db
    .from("zernio_logs")
    .select(SELECT)
    .eq("id", id)
    .like("event_id", `${OUTBOX_PREFIX}%`)
    .maybeSingle();
  if (dataError) throw serverFailure(`Очередь отправки: ${dataError.message}`);
  if (!data) return false;
  const row = rowOf(data);
  const { error } = await ctx.db
    .from("zernio_logs")
    .update({
      status: "queued",
      payload: toJson({
        target: row.target,
        text: row.text,
        order_id: row.orderId,
        audience: row.audience,
        attempts: 0,
        next_at: now.toISOString(),
        last_error: row.lastError,
      }),
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
