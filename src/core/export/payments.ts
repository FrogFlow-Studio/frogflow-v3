import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { pageAll } from "@/core/db/page";
import { ORDER_EVENT_STATUS } from "@/core/orders/events";
import { ORDER_STATUS_RU as STATUS_RU } from "@/core/orders/pure";
import { RETENTION } from "@/core/retention/retention";
import { serverFailure } from "@/lib/server-failure";
import { shopDateTime, toCsv, zonedDayToUtc } from "./csv";

/**
 * Выгрузка «Оплаты» для бухгалтера: строка на каждый платёж, дата — когда
 * деньги записаны, а не когда создан заказ. Источник — журнал заказа
 * (core/orders/events):
 * - `payment` — задаток по чеку, «Внести оплату», ручной заказ, онлайн-оплата
 *   (Robokassa, Telegram Stars);
 * - `balance_credited` — остаток, оплаченный онлайн;
 * - `delivery_started` — цифровой заказ, оплаченный переводом по чеку: у него
 *   своего платежа в журнале нет, оплата подтверждается первой выдачей (или
 *   онлайн-оплатой до этой выгрузки, её событие `payment` тогда не писалось).
 *   Считается только первая выдача, только если у заказа нет `payment` и
 *   есть чек или отметка шлюза: повторная выдача — не новые деньги, а выдача
 *   без чека (продавец выдал сам, бесплатно, за сертификат) — не платёж.
 * Контактов покупателя нет вовсе — выгрузка открыта бухгалтеру.
 * Журнал хранится 180 дней; оплаты, принятые прежней платформой, в нём не
 * видны. У заказа старше этого срока первая выдача могла уйти из журнала,
 * поэтому его выдачи платежом не считаются. Онлайн-оплаты физических заказов
 * до появления этой выгрузки события `payment` не имеют и в неё не попадают
 * (подсказка у кнопки это говорит).
 */

const KINDS = ["order.payment", "order.balance_credited", "order.delivery_started"] as const;
const LOOKUP_CHUNK = 200;

type EventRow = {
  id: string;
  created_at: string;
  event_type: string;
  payload: Json;
};

type OrderRow = {
  id: number;
  order_no: number;
  display_no: number | null;
  total: number | string;
  currency: string;
  status: string;
  platform: string | null;
  fulfillment_kind: string;
  payment_proof_path: string | null;
  created_at: string;
};

const obj = (p: Json): Record<string, Json | undefined> =>
  p && typeof p === "object" && !Array.isArray(p) ? p : {};
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const num = (v: Json | undefined) => Number(v ?? 0) || 0;

/** Кто записал платёж: логин продавца или «автоматически». */
export function paymentActor(actor: string): string {
  if (actor.startsWith("admin")) return actor.slice("admin:".length) || "продавец";
  return "автоматически";
}

/** Способ оплаты цифрового заказа по тому, что лежит в payment_proof_path. */
export function proofMethod(path: string | null): string {
  if (!path) return "без чека";
  if (path.startsWith("Robokassa")) return "Robokassa";
  if (path.startsWith("Telegram Stars")) return "Telegram Stars";
  if (path.startsWith("Продамус")) return "Продамус";
  return "перевод по чеку";
}

export type PaymentRow = {
  at: string;
  orderId: number;
  kind: string;
  method: string;
  amount: number;
  currency: string;
  invId: string;
  actor: string;
};

async function inChunks<T>(ids: number[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK)
    out.push(...(await read(ids.slice(i, i + LOOKUP_CHUNK).map(String))));
  return out;
}

export async function paymentsCsv(
  ctx: TenantContext,
  range: { from?: string | null; to?: string | null } = {},
): Promise<{ csv: string; count: number }> {
  const tz = ctx.timezone;
  const events = await pageAll<EventRow>((from, to) => {
    let q = ctx.db
      .from("zernio_logs")
      .select("id, created_at, event_type, payload")
      .eq("bot_id", ctx.tenant.id)
      .eq("status", ORDER_EVENT_STATUS)
      .in("event_type", [...KINDS])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (range.from) q = q.gte("created_at", zonedDayToUtc(range.from, tz));
    if (range.to) q = q.lte("created_at", zonedDayToUtc(range.to, tz, true));
    return q;
  }, "журнал оплат для выгрузки");

  const orderIds = [...new Set(events.map((e) => num(obj(e.payload).order_id)).filter(Boolean))];
  const orders = new Map<number, OrderRow>();
  for (const o of await inChunks(orderIds, async (chunk) => {
    const { data, error } = await ctx.db
      .from("orders")
      .select(
        "id, order_no, display_no, total, currency, status, platform, fulfillment_kind, payment_proof_path, created_at",
      )
      .eq("bot_id", ctx.tenant.id)
      .in("id", chunk.map(Number));
    if (error) throw serverFailure(`заказы для выгрузки оплат: ${error.message}`);
    return (data ?? []) as OrderRow[];
  }))
    orders.set(o.id, o);

  // Цифровые заказы с выдачей в периоде: вся их история платежей и выдач
  // (в том числе до начала периода) — чтобы взять только первую выдачу и
  // только у заказов без записанного платежа.
  const deliveredIds = [
    ...new Set(
      events
        .filter((e) => e.event_type === "order.delivery_started")
        .map((e) => num(obj(e.payload).order_id))
        .filter((id) => orders.get(id) && orders.get(id)!.fulfillment_kind !== "physical"),
    ),
  ];
  const history = await inChunks(deliveredIds, (chunk) =>
    pageAll<EventRow>(
      (from, to) =>
        ctx.db
          .from("zernio_logs")
          .select("id, created_at, event_type, payload")
          .eq("bot_id", ctx.tenant.id)
          .eq("status", ORDER_EVENT_STATUS)
          .in("event_type", ["order.payment", "order.delivery_started"])
          .in("payload->>order_id", chunk)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      "журнал выдач для выгрузки оплат",
    ),
  );
  const hasPayment = new Set<number>();
  const firstDelivery = new Map<number, EventRow>();
  for (const e of history) {
    const id = num(obj(e.payload).order_id);
    if (e.event_type === "order.payment") hasPayment.add(id);
    else {
      const cur = firstDelivery.get(id);
      if (
        !cur ||
        e.created_at < cur.created_at ||
        (e.created_at === cur.created_at && e.id < cur.id)
      )
        firstDelivery.set(id, e);
    }
  }

  const keepFrom = Date.now() - RETENTION.zernioLogsStaleDays * 86_400_000;
  const rows: Array<PaymentRow & { order: OrderRow }> = [];
  for (const e of events) {
    const p = obj(e.payload);
    const order = orders.get(num(p.order_id));
    if (!order) continue;
    const base = {
      at: e.created_at,
      orderId: order.id,
      order,
      currency: str(p.currency) || order.currency,
      actor: paymentActor(str(p.actor) || "bot"),
    };
    if (e.event_type === "order.payment") {
      const amount = num(p.amount);
      if (amount <= 0) continue;
      const source = str(p.source);
      // Онлайн-оплата части физического заказа — это его задаток.
      const onlineDeposit =
        source === "online" &&
        order.fulfillment_kind === "physical" &&
        amount < (Number(order.total) || 0) - 0.01;
      rows.push({
        ...base,
        amount,
        kind:
          source === "deposit" || onlineDeposit
            ? "задаток"
            : source === "online" || source === "receipt"
              ? "оплата заказа"
              : "внесено",
        method:
          source === "deposit"
            ? "перевод по чеку"
            : source === "receipt"
              ? "перевод по чеку"
              : source === "online"
                ? proofMethod(str(p.provider))
                : "вручную продавцом",
        invId: str(p.invId),
      });
    } else if (e.event_type === "order.balance_credited") {
      const amount = num(p.amount);
      if (amount <= 0) continue;
      rows.push({
        ...base,
        amount,
        kind: "остаток",
        method: str(p.provider) || "онлайн",
        invId: str(p.invId),
      });
    } else {
      if (order.fulfillment_kind === "physical" || hasPayment.has(order.id)) continue;
      if (firstDelivery.get(order.id)?.id !== e.id) continue;
      // Выдача без чека и без отметки шлюза — продавец выдал сам: денег нет.
      if (!order.payment_proof_path) continue;
      // Первая выдача старого заказа могла уйти из журнала — эта может быть повторной.
      if (Date.parse(order.created_at) < keepFrom) continue;
      const amount = Number(order.total) || 0;
      // Заказ целиком оплачен сертификатом или баллами — денег не было.
      if (amount <= 0) continue;
      rows.push({
        ...base,
        currency: order.currency,
        amount,
        kind: "оплата заказа",
        method: proofMethod(order.payment_proof_path),
        invId: "",
      });
    }
  }

  const headers = [
    "Дата оплаты",
    "Заказ",
    "Вид платежа",
    "Способ",
    "Сумма",
    "Валюта",
    "Номер счёта",
    "Кто записал",
    "Канал заказа",
    "Статус заказа",
  ];
  const table = rows.map((r) => [
    shopDateTime(r.at, tz),
    r.order.display_no ?? r.order.order_no ?? r.order.id,
    r.kind,
    r.method,
    r.amount,
    r.currency,
    r.invId,
    r.actor,
    r.order.platform ?? "telegram",
    STATUS_RU[r.order.status] ?? r.order.status,
  ]);
  return { csv: toCsv(headers, table), count: rows.length };
}
