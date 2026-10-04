import type { Json } from "@/core/db-types";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { chunksOf, IN_CHUNK } from "@/lib/in-chunks";
import { pageAll } from "@/core/db/page";
import { lastInboundAt } from "@/core/chat/chat";
import { replyWindow } from "@/core/chat/reply-window";
import { claimOrderEvent, recordOrderEvent } from "@/core/orders/events";
import { orderChannel } from "@/core/orders/pure";
import { orderBuyerLocale } from "@/core/orders/buyer-locale";
import { REJECTABLE_STATUSES } from "@/core/orders/orders";

/**
 * Перенос срока предзаказа (core/preorder): покупателям с открытым заказом на
 * этот товар уходит одно сообщение о новой дате. «Один раз на перенос» — это
 * событие заказа `preorder_moved` с ключом «товар + было → стало»: его
 * записывает условная вставка (уникальный event_id) до отправки, и сообщение
 * шлёт только выигравший — два сохранения карточки подряд или параллельно
 * дают одно сообщение. Вне окна ответа 24 часа (Instagram/WhatsApp) и без
 * канала (сайт, ручной заказ) покупателю не пишем: заказ уходит в список
 * «не смогли сообщить» продавцу.
 */
export type MovedOrder = {
  id: number;
  displayNo: number;
  platform: string;
  telegramId: number;
  userKey: string | null;
};

export type PreorderMove = {
  productId: string;
  name: string;
  from: string | null;
  to: string | null;
};

/** Перенос — когда предзаказ был и остался, а дата другая. */
export function isMove(
  before: { from: string | null } | null,
  after: { from: string | null } | null,
): boolean {
  return Boolean(before) && Boolean(after) && before!.from !== after!.from;
}

/** Открытые заказы с позицией-предзаказом на этот товар (по событиям `order.preorder`). */
export async function openPreorderOrders(
  ctx: TenantContext,
  productId: string,
): Promise<MovedOrder[]> {
  const events = await pageAll(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("id, payload")
        .eq("event_type", "order.preorder")
        .contains("payload", { lines: [{ product_id: productId }] })
        .order("id")
        .range(from, to),
    "Перенос предзаказа: события заказов",
  );
  const ids = [
    ...new Set(
      events
        .map((e) => Number((e.payload as { order_id?: unknown } | null)?.order_id))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  const out: MovedOrder[] = [];
  for (const chunk of chunksOf(ids, IN_CHUNK)) {
    const rows = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id, display_no, order_no, platform, telegram_id, user_key")
          .in("id", chunk)
          .in("status", [...REJECTABLE_STATUSES])
          .order("id")
          .range(from, to),
      "Перенос предзаказа: заказы",
    );
    for (const r of rows)
      out.push({
        id: r.id,
        displayNo: Number(r.display_no ?? r.order_no),
        platform: r.platform ?? "telegram",
        telegramId: Number(r.telegram_id),
        userKey: r.user_key,
      });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Отправка одному покупателю на его языке; true — ушло. */
export type MovedSender = (order: MovedOrder, locale: Locale) => Promise<boolean>;

export type MoveResult = {
  notified: number;
  /** Не смогли сообщить: вне окна, нет канала, отправка не ушла. */
  missed: MovedOrder[];
  /** Не успели из-за бюджета времени — досылаются повторным переносом/сохранением. */
  left: number;
};

export const MOVE_BUDGET_MS = 90_000;

const key = (m: PreorderMove) => `${m.productId}:${m.from ?? "-"}>${m.to ?? "-"}`;

export async function notifyPreorderMoved(
  ctx: TenantContext,
  move: PreorderMove,
  send: MovedSender,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<MoveResult> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const r: MoveResult = { notified: 0, missed: [], left: 0 };
  const orders = await openPreorderOrders(ctx, move.productId);
  for (let i = 0; i < orders.length; i++) {
    if (clock() - started >= (opts.budgetMs ?? MOVE_BUDGET_MS)) {
      r.left = orders.length - i;
      break;
    }
    const o = orders[i]!;
    const channel = orderChannel(o.platform);
    let reachable = channel === "telegram" || channel === "zernio";
    if (channel === "zernio") {
      try {
        reachable =
          replyWindow(o.platform, await lastInboundAt(ctx, o.telegramId), clock())?.state ===
          "open";
      } catch (e) {
        // Окно не прочиталось — заказ не трогаем, переносу можно повторить.
        console.error(`[preorder-move:${ctx.tenant.id}] #${o.id}`, e);
        r.left++;
        continue;
      }
    }
    // Запись «сообщаем» — до отправки; не выиграли — сообщение уже ушло (или уйдёт) от другого.
    const won = await claimOrderEvent(
      ctx,
      o.id,
      "preorder_moved",
      key(move),
      { product_id: move.productId, name: move.name, from: move.from, to: move.to } as Record<
        string,
        Json
      >,
      "seller",
    );
    if (!won) continue;
    let ok = false;
    if (reachable) {
      try {
        ok = await send(
          o,
          await orderBuyerLocale(ctx, { user_key: o.userKey, telegram_id: o.telegramId }),
        );
      } catch (e) {
        console.error(`[preorder-move:${ctx.tenant.id}] #${o.id}`, e);
      }
    }
    if (ok) r.notified++;
    else {
      r.missed.push(o);
      await recordOrderEvent(
        ctx,
        o.id,
        "notify_failed",
        { text: `новый срок предзаказа «${move.name}»: ${move.to ?? "без даты"}` },
        "seller",
      );
    }
  }
  return r;
}
