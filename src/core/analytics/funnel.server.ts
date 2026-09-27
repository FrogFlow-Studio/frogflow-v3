/**
 * Воронка покупателя за окно [from, to): три постраничных чтения по порядку
 * (правило больших магазинов, #156) и сборка в core/analytics/funnel.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import { eachPage } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import { buyerKey, FunnelAcc, type FunnelRow } from "./funnel";
import {
  firstSource,
  SOURCE_DIRECT,
  SourceFunnelAcc,
  sourceGroup,
  type SourceRow,
} from "./source-funnel";

export async function buyerFunnel(ctx: TenantContext, from: Date, to: Date): Promise<FunnelRow[]> {
  const since = from.toISOString();
  const until = to.toISOString();
  const acc = new FunnelAcc();
  await Promise.all([
    eachPage(
      (a, b) =>
        ctx.db
          .from("bot_users")
          .select("platform, user_key")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at")
          .order("user_key")
          .range(a, b),
      "покупатели для воронки",
      (rows) => {
        for (const u of rows) acc.user(u);
      },
    ),
    eachPage(
      (a, b) =>
        ctx.db
          .from("cart_items")
          .select("user_key, telegram_id")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at")
          .order("id")
          .range(a, b),
      "корзины для воронки",
      (rows) => {
        for (const c of rows) acc.cartItem(c);
      },
    ),
    eachPage(
      (a, b) =>
        ctx.db
          .from("orders")
          .select("platform, user_key, telegram_id, status, fulfillment_kind")
          .gte("created_at", since)
          .lt("created_at", until)
          .order("created_at")
          .order("id")
          .range(a, b),
      "заказы для воронки",
      (rows) => {
        for (const o of rows) acc.order(o);
      },
    ),
  ]);
  return acc.rows();
}

/**
 * Воронка по источникам (core/analytics/source-funnel) за то же окно.
 * Источник заказа и корзины — источник покупателя: он лежит в bot_users,
 * а не в заказе, поэтому после каждой страницы заказов и корзин
 * дочитываются только их покупатели, по 100 ключей, с запоминанием.
 * Заказы и корзины в памяти не копятся — только ключи покупателей периода.
 */
export async function sourceFunnel(ctx: TenantContext, from: Date, to: Date): Promise<SourceRow[]> {
  const since = from.toISOString();
  const until = to.toISOString();
  const acc = new SourceFunnelAcc();
  const known = new Map<string, string>();
  const resolve = async (keys: string[]) => {
    const need = [...new Set(keys)].filter((k) => !known.has(k));
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const { data, error } = await ctx.db
        .from("bot_users")
        .select("user_key, state")
        .in("user_key", chunk);
      if (error) throw serverFailure(`Источники покупателей: ${error.message}`);
      for (const u of (data ?? []) as Array<{ user_key: string; state: unknown }>)
        known.set(u.user_key, sourceGroup(firstSource(u.state)));
      for (const k of chunk) if (!known.has(k)) known.set(k, SOURCE_DIRECT);
    }
  };
  await eachPage(
    (a, b) =>
      ctx.db
        .from("bot_users")
        .select("platform, user_key, state")
        .gte("created_at", since)
        .lt("created_at", until)
        .order("created_at")
        .order("user_key")
        .range(a, b),
    "покупатели для воронки по источникам",
    (rows) => {
      for (const u of rows) acc.user(u);
    },
  );
  await eachPage(
    (a, b) =>
      ctx.db
        .from("cart_items")
        .select("user_key, telegram_id")
        .gte("created_at", since)
        .lt("created_at", until)
        .order("created_at")
        .order("id")
        .range(a, b),
    "корзины для воронки по источникам",
    async (rows) => {
      const keys = rows.map((c) => buyerKey(c.user_key, c.telegram_id));
      await resolve(keys);
      for (const k of keys) acc.cartItem(k, known.get(k) ?? SOURCE_DIRECT);
    },
  );
  await eachPage(
    (a, b) =>
      ctx.db
        .from("orders")
        .select(
          "platform, user_key, telegram_id, status, fulfillment_kind, total, paid_amount, currency",
        )
        .gte("created_at", since)
        .lt("created_at", until)
        .order("created_at")
        .order("id")
        .range(a, b),
    "заказы для воронки по источникам",
    async (rows) => {
      await resolve(rows.map((o) => buyerKey(o.user_key, o.telegram_id)));
      for (const o of rows)
        acc.order(o, known.get(buyerKey(o.user_key, o.telegram_id)) ?? SOURCE_DIRECT);
    },
  );
  return acc.rows();
}
