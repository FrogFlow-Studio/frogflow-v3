import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { ORDER_EVENT_STATUS } from "@/core/orders/events";
import { chunksOf } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import { PULSE_DAYS, PULSE_ORDER_STATUSES, computePulse, type Pulse } from "./pulse";

const DAY_MS = 86_400_000;
const LOGIN_DAYS = 90;

export type PulseClient = {
  id: string;
  status: string;
  createdAt: string | null;
};

async function readChunked<T>(chunks: string[][], read: (chunk: string[]) => Promise<T[]>) {
  const out: T[] = [];
  for (const chunk of chunks) out.push(...(await read(chunk)));
  return out;
}

/** Действия продавца с заказами с `since`: куски по 200 клиентов, каждый постранично. */
async function readSellerActions(chunks: string[][], since: string) {
  const out: { id: string; bot_id: string | null; created_at: string }[] = [];
  for (const chunk of chunks)
    out.push(
      ...(await pageAll<{ id: string; bot_id: string | null; created_at: string }>(
        (from, to) =>
          serviceDb()
            .from("zernio_logs")
            .select("id, bot_id, created_at")
            .in("bot_id", chunk)
            // Журнал заказа (core/orders/events): `order.<вид>`, статус «event». Отметки автосообщений,
            // учёта диалогов и вебхуков Zernio в пульс не входят.
            .eq("status", ORDER_EVENT_STATUS)
            .like("event_type", "order.%")
            .like("payload->>actor", "admin%")
            .gte("created_at", since)
            .order("id", { ascending: true })
            .range(from, to),
        "Действия продавцов для пульса не прочитаны",
      )),
    );
  return out;
}

/**
 * Последний оплаченный заказ клиента старше окна 28 дней: одна строка по смыслу
 * («самый свежий»), а не обрезка. Сортировка кончается уникальным `id`. Сбой
 * чтения — исключение: «не прочитали» не равно «давно без заказов».
 */
async function readLastPaidOrder(botId: string): Promise<string | null> {
  const { data, error } = await serviceDb()
    .from("orders")
    .select("created_at")
    .eq("bot_id", botId)
    .in("status", [...PULSE_ORDER_STATUSES])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error)
    throw serverFailure(`Последний оплаченный заказ для пульса не прочитан: ${error.message}`);
  return data?.[0]?.created_at ?? null;
}

/**
 * Пульс всех переданных клиентов двумя постраничными чтениями на всех сразу
 * (оплаченные заказы за 28 дней и успешные входы продавцов за 90), а не запросом на
 * клиента. Ошибка чтения — исключение: «не прочитали» не равно «затих».
 */
export async function loadPulse(
  clients: PulseClient[],
  now = new Date(),
): Promise<Map<string, Pulse>> {
  const out = new Map<string, Pulse>();
  if (clients.length === 0) return out;
  const ids = new Set(clients.map((c) => c.id));
  const ordersSince = new Date(now.getTime() - 2 * PULSE_DAYS * DAY_MS).toISOString();
  const loginsSince = new Date(now.getTime() - LOGIN_DAYS * DAY_MS).toISOString();
  // Только клиенты v2 и кусками по 200: список клиентов в адрес запроса целиком не помещается.
  const chunks = chunksOf([...ids]);
  const actionsSince = new Date(now.getTime() - PULSE_DAYS * DAY_MS).toISOString();
  const [orders, logins, actions] = await Promise.all([
    readChunked(chunks, (chunk) =>
      pageAll<{ id: number; bot_id: string | null; created_at: string }>(
        (from, to) =>
          serviceDb()
            .from("orders")
            .select("id, bot_id, created_at")
            .in("bot_id", chunk)
            .in("status", [...PULSE_ORDER_STATUSES])
            .gte("created_at", ordersSince)
            .order("id", { ascending: true })
            .range(from, to),
        "Заказы для пульса не прочитаны",
      ),
    ),
    readChunked(chunks, (chunk) =>
      pageAll<{ id: string; bot_id: string; at: string }>(
        (from, to) =>
          serviceDb()
            .from("admin_login_attempts")
            .select("id, bot_id, at")
            .in("bot_id", chunk)
            .eq("ok", true)
            .gte("at", loginsSince)
            .order("id", { ascending: true })
            .range(from, to),
        "Входы продавцов для пульса не прочитаны",
      ),
    ),
    // Действия продавца с заказами (подтвердил в Telegram и т.п.) — журнал заказа, actor admin*.
    readSellerActions(chunks, actionsSince),
  ]);
  const ordersBy = new Map<string, string[]>();
  for (const o of orders) {
    if (!o.bot_id || !ids.has(o.bot_id)) continue;
    const list = ordersBy.get(o.bot_id);
    if (list) list.push(o.created_at);
    else ordersBy.set(o.bot_id, [o.created_at]);
  }
  const lastLogin = new Map<string, string>();
  for (const l of logins) {
    if (!ids.has(l.bot_id)) continue;
    const prev = lastLogin.get(l.bot_id);
    if (!prev || Date.parse(l.at) > Date.parse(prev)) lastLogin.set(l.bot_id, l.at);
  }
  const lastAction = new Map<string, string>();
  for (const a of actions) {
    if (!a.bot_id) continue;
    const prev = lastAction.get(a.bot_id);
    if (!prev || Date.parse(a.created_at) > Date.parse(prev))
      lastAction.set(a.bot_id, a.created_at);
  }
  // «Без заказов N дн» — по оплаченным: брошенный вчера клиента не оживляет. Из 28 дней —
  // уже прочитанное; у кого там пусто, ищем последний оплаченный отдельно, по несколько разом.
  const lastPaid = new Map<string, string | null>();
  for (const [id, list] of ordersBy)
    lastPaid.set(
      id,
      list.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)),
    );
  const missing = clients.filter((c) => !lastPaid.has(c.id));
  for (const group of chunksOf(missing, 10))
    await Promise.all(group.map(async (c) => lastPaid.set(c.id, await readLastPaidOrder(c.id))));
  for (const c of clients) {
    out.set(
      c.id,
      computePulse({
        ordersAt: ordersBy.get(c.id) ?? [],
        lastLoginAt: lastLogin.get(c.id) ?? null,
        lastSellerActionAt: lastAction.get(c.id) ?? null,
        lastOrderAt: lastPaid.get(c.id) ?? null,
        createdAt: c.createdAt,
        status: c.status,
        now,
      }),
    );
  }
  return out;
}
