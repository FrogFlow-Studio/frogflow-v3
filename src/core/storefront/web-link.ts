import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { getCustomer, stateFromJson, userKey, type Customer } from "@/core/customers/customers";
import type { OrderWithItems } from "@/core/orders/orders";

/**
 * Старые заказы с сайта у покупателя, вошедшего через Telegram. Почту на
 * сайте никто не подтверждает, поэтому совпадение почты ничего не связывает:
 * иначе любой, оформив заказ на чужую почту и войдя через свой Telegram,
 * увидел бы чужие заказы и материалы. Заказ привязывается по одному и только
 * тем, кто доказал владение: открыл его по подписанной ссылке (токен заказа
 * проверяет серверная функция) и нажал «Привязать к моему Telegram».
 *
 * Строки заказов не переписываются (их telegram_id остаётся покупателем
 * сайта, v1 читает ту же базу). Связка — в bot_users.state двух покупателей:
 * у покупателя сайта telegram_links[orderId] = telegram_id (кто первый
 * привязал, того и заказ), у покупателя из Telegram — список web_orders,
 * по которому «Мои заказы» и карточка продавца дочитывают эти заказы.
 */
export const WEB_LINK_MAX = 100;

export type LinkResult =
  | "linked"
  /** Заказ уже его: оформлен после входа или привязан раньше. */
  | "already"
  /** Не заказ с сайта (счёт из Direct и т. п.) или его нет. */
  | "not_web"
  /** Заказ привязан к другому Telegram. */
  | "taken"
  | "full"
  | "no_customer"
  | "busy";

export function linkedWebOrderIds(state: { web_orders?: unknown }): number[] {
  const raw = state.web_orders;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is number => Number.isSafeInteger(x) && x > 0).slice(0, WEB_LINK_MAX);
}

type Versioned = "web_orders_v" | "telegram_links_v";

/**
 * Условная запись state по счётчику своего поля, а не по всему state: весь
 * state уходит в адрес запроса, и у покупателя с длинной историей PostgREST
 * отвечает 431 (адрес длиннее предела). Счётчик растёт с каждой нашей
 * записью; два одновременных привязывания не затрут друг друга. Сбой
 * записи — ошибка, а не «занято».
 */
async function casState(
  ctx: TenantContext,
  key: string,
  field: Versioned,
  state: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const seen = versionOf(state[field]);
  const base = ctx.db
    .from("bot_users")
    .update({ state: { ...state, ...patch, [field]: seen + 1 } as Json })
    .eq("user_key", key);
  const path = `state->>${field}`;
  const guarded = seen === 0 ? base.is(path, null) : base.eq(path, String(seen));
  // Шаг диалога тот же: параллельный шаг бота не затираем, перечитываем.
  const mode = state.mode;
  const { data, error } = await (
    typeof mode === "string" && mode
      ? guarded.eq("state->>mode", mode)
      : guarded.is("state->>mode", null)
  ).select("user_key");
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

function versionOf(v: unknown): number {
  return Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : 0;
}

async function readState(ctx: TenantContext, key: string): Promise<Json | null | undefined> {
  const { data, error } = await ctx.db
    .from("bot_users")
    .select("state")
    .eq("user_key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data.state as Json | null) : undefined;
}

/**
 * Привязать заказ с сайта к покупателю из Telegram. Вызывать только после
 * проверки подписи ссылки заказа и сессии входа через Telegram.
 */
export async function linkWebOrder(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
): Promise<LinkResult> {
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("id, platform, telegram_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!order || order.platform !== "web") return "not_web";
  if (Number(order.telegram_id) === telegramId) return "already";

  const tg = await getCustomer(ctx, userKey("telegram", telegramId));
  if (!tg || tg.platform !== "telegram") return "no_customer";

  // Владелец заказа — покупатель сайта по почте; заказ, оформленный другим
  // вошедшим через Telegram, чужой.
  const { data: owner, error: ownerError } = await ctx.db
    .from("bot_users")
    .select("user_key, platform")
    .eq("telegram_id", Number(order.telegram_id))
    .maybeSingle();
  if (ownerError) throw new Error(ownerError.message);
  if (!owner || owner.platform !== "web") return "taken";

  // Список покупателя полон — заказ не занимаем: иначе он остался бы
  // привязанным, но невидимым.
  if (linkedWebOrderIds(tg.state).length >= WEB_LINK_MAX) return "full";

  const id = String(orderId);
  let claimed = false;
  for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
    const raw = await readState(ctx, owner.user_key);
    if (raw === undefined) return "not_web";
    const state = stateFromJson(raw);
    const links = { ...(state.telegram_links ?? {}) };
    const holder = links[id];
    if (holder !== undefined && holder !== telegramId) return "taken";
    if (holder === telegramId) {
      claimed = true;
      break;
    }
    links[id] = telegramId;
    claimed = await casState(ctx, owner.user_key, "telegram_links_v", state, {
      telegram_links: links,
    });
  }
  if (!claimed) return "busy";

  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await readState(ctx, tg.userKey);
    if (raw === undefined) return "no_customer";
    const state = stateFromJson(raw);
    const ids = linkedWebOrderIds(state);
    if (ids.includes(orderId)) return "already";
    if (ids.length >= WEB_LINK_MAX) return "full";
    if (await casState(ctx, tg.userKey, "web_orders_v", state, { web_orders: [...ids, orderId] }))
      return "linked";
  }
  return "busy";
}

/**
 * Привязан ли заказ к этому покупателю из Telegram (или оформлен им). Для
 * кнопки на странице заказа: «привязать» или «уже в ваших заказах».
 */
export async function webOrderLinkState(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
): Promise<"linked" | "linkable" | null> {
  const { data: order } = await ctx.db
    .from("orders")
    .select("id, platform, telegram_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.platform !== "web") return null;
  if (Number(order.telegram_id) === telegramId) return "linked";
  const tg = await getCustomer(ctx, userKey("telegram", telegramId));
  if (!tg) return null;
  return linkedWebOrderIds(tg.state).includes(orderId) ? "linked" : "linkable";
}

/**
 * Привязанные заказы с сайта покупателя (с позициями), новые первыми.
 * Только заказы с сайта: список в state пишет linkWebOrder, но и чужая
 * запись в state не откроет заказ другого канала.
 */
export async function linkedWebOrders(
  ctx: TenantContext,
  customer: Pick<Customer, "state">,
): Promise<OrderWithItems[]> {
  const ids = linkedWebOrderIds(customer.state);
  if (!ids.length) return [];
  const { data, error } = await ctx.db
    .from("orders")
    .select("*, order_items(*)")
    .in("id", ids)
    .eq("platform", "web")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderWithItems[];
}

/** Заказы бота и привязанные с сайта вместе, без повторов, новые первыми. */
export function mergeOrders<T extends { id: number; created_at: string }>(a: T[], b: T[]): T[] {
  const seen = new Set<number>();
  return [...a, ...b]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((x, y) =>
      x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : y.id - x.id,
    );
}
