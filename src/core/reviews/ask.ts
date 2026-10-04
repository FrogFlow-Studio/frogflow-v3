import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Json } from "@/core/db-types";
import { eachPage } from "@/core/db/page";
import { getSettingsStrict } from "@/core/settings/settings";
import {
  customerFromRow,
  stateFromJson,
  type Customer,
  type DialogState,
} from "@/core/customers/customers";
import { lastInboundAt } from "@/core/chat/chat";
import { replyWindow } from "@/core/chat/reply-window";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import { daytime } from "@/core/winback/winback";
import { serverFailure } from "@/lib/server-failure";
import { reviewableProductsForOrder } from "./reviews";

/**
 * Просьба об оценке после выдачи (модуль review_request): через N дней после
 * того, как заказ выдан, покупателю уходит одно сообщение с просьбой оценить
 * товар. N — настройка продавца `bots.settings.review_ask_days` (1–30, по
 * умолчанию 3).
 *
 * Один раз на заказ: отметка — строка app_settings `review_ask:<id заказа>`,
 * её вставка (ключ уникален) и есть захват; из двух кронов, дошедших до одного
 * заказа, пишет тот, чья вставка прошла. Отметка ставится ДО отправки и после
 * отправки не снимается: сообщение могло дойти, повторять нельзя. Снимается
 * она только когда отправка ещё не началась (потолок маркетинговых сообщений
 * занят, не удалось подготовить диалог) — тогда заказ возьмут в следующий
 * проход, пока он не вышел за край опоздания (N + 3 дня).
 *
 * Срок отсчитывается от orders.updated_at выданного заказа: отдельного
 * времени выдачи в базе нет, поздняя правка заказа сдвигает просьбу позже, а
 * не раньше. Просьба — маркетинговое сообщение: днём по поясу магазина,
 * отписавшимся и заблокированным — никогда, общий суточный потолок
 * (core/marketing/cap) её тоже считает. Право на отзыв прежнее — реально
 * выданная покупка; товары, которые покупатель уже оценил, не просим.
 *
 * Telegram — кнопками оценки (старый путь кнопки «Оценить» остаётся). Instagram
 * и WhatsApp — только пока открыто 24-часовое окно ответа (core/chat/reply-window):
 * покупатель отвечает цифрой 1–5, диалог ждёт её в mode `awaiting_rating`.
 */
export const REVIEW_ASK_KEY_PREFIX = "review_ask:";
export const REVIEW_ASK_DEFAULT_DAYS = 3;
export const REVIEW_ASK_MAX_DAYS = 30;
/** Заказы старше N + 3 дней не догоняем: после включения или долгого сбоя не пишем за всю историю. */
export const REVIEW_ASK_LATE_DAYS = 3;
export const REVIEW_ASK_BATCH = 50;
const DAY = 86_400_000;

export const reviewAskKey = (orderId: number) => `${REVIEW_ASK_KEY_PREFIX}${orderId}`;

/** Дни до просьбы: целое 1–30; пусто или мусор — по умолчанию. */
export function reviewAskDays(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= REVIEW_ASK_MAX_DAYS ? n : REVIEW_ASK_DEFAULT_DAYS;
}

/** Ответ покупателя на просьбу в Direct/WhatsApp: «5», «5⭐», «5 ★» — иначе не оценка. */
export function parseRatingReply(text: string): number | null {
  const m = /^\s*([1-5])\s*[⭐★]*\s*$/u.exec(text);
  return m ? Number(m[1]) : null;
}

export type ReviewAsk = {
  orderId: number;
  orderNo: number;
  /** Не оценённые покупателем товары заказа; Direct/WhatsApp просит про первый. */
  products: Array<{ id: string; name: string }>;
};
export type ReviewAskSender = (to: Customer, ask: ReviewAsk) => Promise<boolean>;

type DueOrder = {
  id: number;
  telegram_id: number;
  display_no: number | null;
  order_no: number;
  updated_at: string;
  created_at?: string | null;
};

/** Занять заказ: вставка новой отметки. false — заказ уже занят другим запуском. */
async function claimOrder(ctx: TenantContext, orderId: number, value: string): Promise<boolean> {
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: reviewAskKey(orderId),
    value,
    updated_at: value,
  });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw serverFailure(`просьба об оценке: отметка заказа: ${error.message}`);
}

/** Снять свою отметку (отправка не началась). Чужую, с другим значением, не трогаем. */
async function releaseOrder(ctx: TenantContext, orderId: number, value: string): Promise<void> {
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .eq("key", reviewAskKey(orderId))
    .eq("value", value);
  if (error) console.error(`[review-ask:${ctx.tenant.id}] отметка не снялась: ${error.message}`);
}

/** Закрыть заказ без просьбы навсегда: нет смысла или нельзя писать. Ошибки не роняют проход. */
async function dismissOrder(ctx: TenantContext, orderId: number, now: Date): Promise<void> {
  try {
    await claimOrder(ctx, orderId, `skip:${now.toISOString()}`);
  } catch (e) {
    console.error(`[review-ask:${ctx.tenant.id}] ${(e as Error).message}`);
  }
}

/** Старше этого срока после края опоздания отметка заказа уже ничего не защищает и удаляется. */
export const REVIEW_ASK_MARK_KEEP_DAYS = 30;

/**
 * Отметки `review_ask:<id>` копились бы навсегда. Заказ старше N + 3 дней в окно
 * просьбы уже не попадёт, так что отметка старше N + 3 + 30 дней лишняя. Время
 * лежит в значении отметки («ask:<ISO>», «skip:<ISO>»). Сбой чистки проход не роняет.
 */
async function pruneOldMarks(ctx: TenantContext, now: Date, days: number): Promise<void> {
  const cutoff = new Date(
    now.getTime() - (days + REVIEW_ASK_LATE_DAYS + REVIEW_ASK_MARK_KEEP_DAYS) * DAY,
  ).toISOString();
  for (const kind of ["ask", "skip"]) {
    const { error } = await ctx.db
      .from("app_settings")
      .delete()
      .like("key", `${REVIEW_ASK_KEY_PREFIX}%`)
      .like("value", `${kind}:%`)
      .lt("value", `${kind}:${cutoff}`);
    if (error) console.error(`[review-ask:${ctx.tenant.id}] чистка отметок: ${error.message}`);
  }
}

export async function runReviewAsk(
  ctx: TenantContext,
  send: ReviewAskSender,
  now = new Date(),
): Promise<{ checked: number; sent: number; failed: number; skipped?: string }> {
  const r = { checked: 0, sent: 0, failed: 0 };
  if (!ctx.tenant.modules.review_request) return { ...r, skipped: "module off" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const days = reviewAskDays(ctx.tenant.settings.review_ask_days);
  const dueEdge = new Date(now.getTime() - days * DAY).toISOString();
  const lateEdge = new Date(now.getTime() - (days + REVIEW_ASK_LATE_DAYS) * DAY).toISOString();

  await pruneOldMarks(ctx, now, days);

  // Выданные заказы окна [опоздание, срок], постранично; уникальный хвост сортировки — id.
  const due: DueOrder[] = [];
  await eachPage<DueOrder>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, telegram_id, display_no, order_no, updated_at, created_at")
        .eq("status", "delivered")
        .gte("updated_at", lateEdge)
        .lte("updated_at", dueEdge)
        .order("id")
        .range(from, to),
    "просьба об оценке: заказы",
    (rows) => void due.push(...rows),
    200,
  );
  if (!due.length) return r;

  // Старый заказ, который только что правили (заметка продавца двигает updated_at), в окно
  // не берём: его отметка могла быть уже удалена чисткой, и просьба ушла бы второй раз.
  // Граница — та же, после которой чистка удаляет отметки.
  const createdEdge = new Date(
    now.getTime() - (days + REVIEW_ASK_LATE_DAYS + REVIEW_ASK_MARK_KEEP_DAYS) * DAY,
  ).toISOString();
  for (let i = due.length - 1; i >= 0; i--) {
    const created = due[i]!.created_at;
    if (created && created < createdEdge) due.splice(i, 1);
  }
  if (!due.length) return r;

  // Заказы, по которым просьба уже была (или закрыта), отбрасываем.
  const done = new Set<number>();
  for (let i = 0; i < due.length; i += 200) {
    const part = due.slice(i, i + 200);
    const got = await getSettingsStrict(
      ctx,
      part.map((o) => reviewAskKey(o.id)),
    );
    for (const o of part) if (reviewAskKey(o.id) in got) done.add(o.id);
  }
  const open = due.filter((o) => !done.has(o.id));

  // Один покупатель — одна просьба, по самому свежему из его заказов.
  const byBuyer = new Map<number, DueOrder[]>();
  for (const o of open) {
    const id = Number(o.telegram_id);
    byBuyer.set(id, [...(byBuyer.get(id) ?? []), o]);
  }
  // Потолок REVIEW_ASK_BATCH — на отправки, а не на первых покупателей списка: ждущие окна
  // Instagram/WhatsApp не должны занимать проход у остальных.
  const buyers = [...byBuyer.entries()];
  if (!buyers.length) return r;
  const cap = await loadMarketingCap(ctx);

  for (const [telegramId, orders] of buyers) {
    if (r.sent + r.failed >= REVIEW_ASK_BATCH) break;
    const newest = orders.reduce((a, b) => (b.id > a.id ? b : a));
    const older = orders.filter((o) => o.id !== newest.id);
    const { data: row, error } = await ctx.db
      .from("bot_users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (error) throw serverFailure(`просьба об оценке: покупатель: ${error.message}`);
    const { data: blocked, error: blockedError } = await ctx.db
      .from("blocked_users")
      .select("telegram_id")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (blockedError) throw serverFailure(`просьба об оценке: блокировки: ${blockedError.message}`);
    const customer = row ? customerFromRow(row) : null;
    const channelOk =
      customer?.platform === "telegram" ||
      customer?.platform === "instagram" ||
      customer?.platform === "whatsapp";
    // Писать нельзя совсем: закрываем все его заказы окна, чтобы не разбирать их каждый час.
    if (!row || !customer || !channelOk || row.opt_out || blocked) {
      for (const o of orders) await dismissOrder(ctx, o.id, now);
      continue;
    }
    r.checked++;
    const products = await unratedProducts(ctx, newest.id, telegramId);
    if (!products.length) {
      for (const o of orders) await dismissOrder(ctx, o.id, now);
      continue;
    }
    const state = stateFromJson(row.state);
    if (customer.platform !== "telegram") {
      // Окно ответа закрыто или человек в середине оформления — подождём: заказ остаётся открытым.
      const w = replyWindow(customer.platform, await lastInboundAt(ctx, telegramId), now.getTime());
      if (w?.state !== "open") continue;
      if (state.mode && state.mode !== "idle") continue;
    }

    const mark = `ask:${now.toISOString()}`;
    if (!(await claimOrder(ctx, newest.id, mark))) continue;
    const marked = await claimMarketing(ctx, row.user_key, row.state, cap, now);
    if (!marked) {
      // Потолок занят другим сообщением: отметку снимаем, заказ возьмём позже.
      await releaseOrder(ctx, newest.id, mark);
      continue;
    }
    let to = customer;
    if (customer.platform !== "telegram") {
      // Диалог ждёт цифру. Запись — только пока метка нашего маркетингового места
      // не сменилась (короткое поле, не весь state: длинный адрес даёт 431).
      const next: DialogState = {
        ...marked,
        mode: "awaiting_rating",
        review_product_id: products[0]!.id,
        review_ask_at: now.toISOString(),
      };
      const last = typeof marked.last_marketing_at === "string" ? marked.last_marketing_at : null;
      const base = ctx.db
        .from("bot_users")
        .update({ state: next as Json })
        .eq("user_key", row.user_key);
      const { data: written, error: writeError } = await (
        last == null
          ? base.is("state->>last_marketing_at", null)
          : base.eq("state->>last_marketing_at", last)
      ).select("user_key");
      if (writeError || !written?.length) {
        await releaseOrder(ctx, newest.id, mark);
        continue;
      }
      to = { ...customer, state: next };
    }
    // Остальные заказы покупателя из окна закрываем: одно сообщение на человека.
    for (const o of older) await dismissOrder(ctx, o.id, now);
    const ok = await send(to, {
      orderId: newest.id,
      orderNo: newest.display_no ?? newest.order_no,
      products,
    }).catch(() => false);
    if (ok) r.sent++;
    else r.failed++;
  }
  return r;
}

/** Товары выданного заказа, которые покупатель ещё не оценил. */
async function unratedProducts(
  ctx: TenantContext,
  orderId: number,
  telegramId: number,
): Promise<Array<{ id: string; name: string }>> {
  const all = await reviewableProductsForOrder(ctx, orderId, telegramId);
  if (!all.length) return [];
  const { data, error } = await ctx.db
    .from("product_reviews")
    .select("product_id")
    .eq("telegram_id", telegramId)
    .in(
      "product_id",
      all.map((p) => p.productId),
    );
  if (error) throw serverFailure(`просьба об оценке: оценки: ${error.message}`);
  const rated = new Set((data ?? []).map((x) => String(x.product_id)));
  return all.filter((p) => !rated.has(p.productId)).map((p) => ({ id: p.productId, name: p.name }));
}
