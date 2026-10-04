import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import { IN_CHUNK, chunksOf } from "@/lib/in-chunks";
import { NOT_COUNTED, PAID, type OrderLite } from "@/core/broadcasts/revenue";

/**
 * Итоги автосообщений («Брошенная корзина», «Возврат клиентов», «Похожие
 * материалы», лист ожидания) на странице «Рассылки». Отметка каждой отправки —
 * строка в zernio_logs (`event_type = automsg`, `status = sent|failed`), как у
 * учёта входящего (core/inbox): своей таблицы нет, схема заморожена. Строки
 * подчищает ретеншен zernio_logs, окно итогов (30 дней) короче его срока.
 */
export const AUTO_MSG_EVENT_TYPE = "automsg";
export const AUTO_KINDS = ["cart", "winback", "similar", "waitlist"] as const;
export type AutoKind = (typeof AUTO_KINDS)[number];

/** Заказ получателя засчитывается, если оформлен в течение 7 дней после сообщения. */
export const AUTO_WINDOW_MS = 7 * 24 * 3600_000;
/** Период итогов. */
export const AUTO_PERIOD_MS = 30 * 24 * 3600_000;

export type AutoEvent = { kind: AutoKind; telegram_id: number; at: string; ok: boolean };

export type AutoStats = {
  /** Отправлено (дошло до отправителя без ошибки). */
  sent: number;
  /** Не отправлено: сбой отправки, закрытое окно ответа и т. п. */
  failed: number;
  /** Получателей, оформивших заказ в течение 7 дней после сообщения. */
  buyers: number;
  /** Заказов получателей в окне (без отменённых и возвращённых). */
  orders: number;
  paid: number;
  /** Выручка оплаченных заказов по валютам. */
  revenue: Record<string, number>;
};

export type AutoStatsByKind = Record<AutoKind, AutoStats>;

export const emptyAutoStats = (): AutoStats => ({
  sent: 0,
  failed: 0,
  buyers: 0,
  orders: 0,
  paid: 0,
  revenue: {},
});

export const emptyAutoStatsByKind = (): AutoStatsByKind => ({
  cart: emptyAutoStats(),
  winback: emptyAutoStats(),
  similar: emptyAutoStats(),
  waitlist: emptyAutoStats(),
});

/**
 * Чистый подсчёт. Заказ засчитывается одному сообщению — последнему
 * отправленному покупателю до заказа (не позже 7 дней назад): два сообщения
 * одному покупателю не удваивают один заказ. Неудачные отправки в атрибуцию
 * не идут: покупатель их не видел.
 */
export function attributeAuto(
  events: readonly AutoEvent[],
  orders: readonly OrderLite[],
): AutoStatsByKind {
  const out = emptyAutoStatsByKind();
  const sentBy = new Map<number, { kind: AutoKind; at: number }[]>();
  for (const e of events) {
    const s = out[e.kind];
    if (!s) continue;
    if (!e.ok) {
      s.failed++;
      continue;
    }
    s.sent++;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) continue;
    const list = sentBy.get(Number(e.telegram_id)) ?? [];
    list.push({ kind: e.kind, at });
    sentBy.set(Number(e.telegram_id), list);
  }
  for (const list of sentBy.values()) list.sort((a, b) => a.at - b.at);

  const buyers = new Map<AutoKind, Set<number>>();
  for (const o of orders) {
    if (NOT_COUNTED.has(o.status)) continue;
    const created = Date.parse(o.created_at);
    if (!Number.isFinite(created)) continue;
    const tg = Number(o.telegram_id);
    let hit: { kind: AutoKind; at: number } | undefined;
    for (const m of sentBy.get(tg) ?? [])
      if (m.at <= created && created <= m.at + AUTO_WINDOW_MS) hit = m;
    if (!hit) continue;
    const s = out[hit.kind];
    s.orders++;
    const set = buyers.get(hit.kind) ?? new Set<number>();
    set.add(tg);
    buyers.set(hit.kind, set);
    if (PAID.has(o.status)) {
      s.paid++;
      const cur = (o.currency || "").toUpperCase();
      s.revenue[cur] = (s.revenue[cur] ?? 0) + (Number(o.total) || 0);
    }
  }
  for (const [kind, set] of buyers) out[kind].buyers = set.size;
  return out;
}

/**
 * Отметить отправку автосообщения. Лучшее старание: сообщение уже ушло (или
 * не ушло), сбой записи не должен ломать крон — он остаётся в журнале ошибок.
 */
export async function recordAutoMessage(
  ctx: TenantContext,
  kind: AutoKind,
  telegramId: number,
  ok: boolean,
  now = new Date(),
): Promise<void> {
  const payload = { kind, telegram_id: telegramId } as unknown as Json;
  try {
    const { error } = await ctx.db.from("zernio_logs").insert({
      bot_id: ctx.tenant.id,
      // event_id уникален на всю базу — с id бота, видом, покупателем и временем.
      event_id: `${AUTO_MSG_EVENT_TYPE}:${ctx.tenant.id}:${kind}:${telegramId}:${now.getTime()}`,
      event_type: AUTO_MSG_EVENT_TYPE,
      status: ok ? "sent" : "failed",
      payload,
      created_at: now.toISOString(),
    });
    if (error) console.error(`[automsg:${ctx.tenant.id}] ${kind} ${telegramId}: ${error.message}`);
  } catch (e) {
    console.error(`[automsg:${ctx.tenant.id}] ${kind} ${telegramId}`, e);
  }
}

/** Итоги за 30 дней по каждому виду; чтение постранично, `.in` кусками по 200. */
export async function autoMessageStats(
  ctx: TenantContext,
  now = Date.now(),
): Promise<AutoStatsByKind> {
  const since = new Date(now - AUTO_PERIOD_MS).toISOString();
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, status, payload, created_at")
        .eq("bot_id", ctx.tenant.id)
        .eq("event_type", AUTO_MSG_EVENT_TYPE)
        .gte("created_at", since)
        .order("id")
        .range(from, to),
    "Автосообщения: отметки отправки",
  );
  const events: AutoEvent[] = [];
  for (const r of rows) {
    const p = (r.payload ?? {}) as { kind?: string; telegram_id?: number };
    const kind = AUTO_KINDS.find((k) => k === p.kind);
    if (!kind || !p.telegram_id) continue;
    events.push({
      kind,
      telegram_id: Number(p.telegram_id),
      at: r.created_at,
      ok: r.status === "sent",
    });
  }
  const orders: OrderLite[] = [];
  const ids = [...new Set(events.filter((e) => e.ok).map((e) => e.telegram_id))];
  for (const chunk of chunksOf(ids, IN_CHUNK))
    orders.push(
      ...(await pageAll(
        (from, to) =>
          ctx.db
            .from("orders")
            .select("id, telegram_id, created_at, status, total, currency")
            .in("telegram_id", chunk)
            .gte("created_at", since)
            .order("id")
            .range(from, to),
        "Автосообщения: заказы получателей",
      )),
    );
  return attributeAuto(events, orders);
}
