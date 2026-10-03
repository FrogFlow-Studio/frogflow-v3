import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { ORDER_EVENT_STATUS } from "@/core/orders/events";
import { chunksOf } from "@/lib/in-chunks";
import { PULSE_DAYS, computePulse, type Pulse } from "./pulse";

const DAY_MS = 86_400_000;
const LOGIN_DAYS = 90;

export type PulseClient = {
  id: string;
  status: string;
  createdAt: string | null;
  /** undefined — статистика клиента не прочиталась. */
  lastOrderAt: string | null | undefined;
};

/** Действия продавца с заказами с `since`: куски по 200 клиентов, каждый постранично. */
async function readSellerActions(botIds: string[], since: string) {
  const out: { id: string; bot_id: string | null; created_at: string }[] = [];
  for (const chunk of chunksOf(botIds))
    out.push(
      ...(await pageAll<{ id: string; bot_id: string | null; created_at: string }>(
        (from, to) =>
          serviceDb()
            .from("zernio_logs")
            .select("id, bot_id, created_at")
            .in("bot_id", chunk)
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
 * Пульс всех переданных клиентов двумя постраничными чтениями на всех сразу
 * (заказы за 28 дней и успешные входы продавцов за 90), а не запросом на
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
  const actionsSince = new Date(now.getTime() - PULSE_DAYS * DAY_MS).toISOString();
  const [orders, logins, actions] = await Promise.all([
    pageAll<{ id: number; bot_id: string | null; created_at: string }>(
      (from, to) =>
        serviceDb()
          .from("orders")
          .select("id, bot_id, created_at")
          .gte("created_at", ordersSince)
          .order("id", { ascending: true })
          .range(from, to),
      "Заказы для пульса не прочитаны",
    ),
    pageAll<{ id: string; bot_id: string; at: string }>(
      (from, to) =>
        serviceDb()
          .from("admin_login_attempts")
          .select("id, bot_id, at")
          .eq("ok", true)
          .gte("at", loginsSince)
          .order("id", { ascending: true })
          .range(from, to),
      "Входы продавцов для пульса не прочитаны",
    ),
    // Действия продавца с заказами (подтвердил в Telegram и т.п.) — журнал заказа, actor admin*.
    readSellerActions([...ids], actionsSince),
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
  for (const c of clients) {
    out.set(
      c.id,
      computePulse({
        ordersAt: ordersBy.get(c.id) ?? [],
        lastLoginAt: lastLogin.get(c.id) ?? null,
        lastSellerActionAt: lastAction.get(c.id) ?? null,
        lastOrderAt: c.lastOrderAt,
        createdAt: c.createdAt,
        status: c.status,
        now,
      }),
    );
  }
  return out;
}
