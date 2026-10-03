import type { TenantContext } from "@/core/tenant/resolve.server";
import { productCategoryIds } from "@/core/catalog/category-ids";
import { getSetting, setSetting } from "@/core/settings/settings";
import { visibleCategoryIds } from "@/core/storefront/categories";
import { pageAll } from "@/core/db/page";
import { isRealTelegramChat } from "@/core/broadcasts/pure";
import { daytime } from "@/core/winback/winback";
import { serverFailure } from "@/lib/server-failure";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import { stateFromJson } from "@/core/customers/customers";

/**
 * «Похожие материалы» (модуль winback, повторные продажи): через N дней
 * после покупки покупателю в Telegram — до трёх товаров из тех же
 * категорий, которых он ещё не покупал, кнопками в карточку товара.
 *
 * Один раз на заказ: курсор — строка app_settings `similar_materials:cursor`
 * (id последнего разобранного заказа), сдвигается сравнением со старым
 * значением до отправки. Упёрся в общий потолок — заказ уходит в список
 * отложенных (SIMILAR_DEFERRED_KEY) и берётся в следующие проходы. В bot_users.state пишется только метка общего
 * потолка маркетинговых сообщений (core/marketing/cap) — условной записью по
 * всему state, так что оформление заказа она не затрёт.
 * Пишем только днём по поясу магазина, не больше SIMILAR_BATCH за проход,
 * отписавшимся и заблокированным — никогда. Один заказ — одно сообщение;
 * если у покупателя есть заказ новее, пишем по нему, а не по старому.
 */
export type SimilarConfig = { enabled: boolean; days: number; text: string };

export const SIMILAR_KEY = "similar_materials";
export const SIMILAR_CURSOR_KEY = "similar_materials:cursor";
export const SIMILAR_MAX_DAYS = 60;
/** Заказы старше N + 3 дней не догоняем: после включения или долгого сбоя не пишем за всю историю. */
export const SIMILAR_LATE_DAYS = 3;
export const SIMILAR_BATCH = 50;
export const SIMILAR_PICKS = 3;
const SCAN = 200;
const DAY = 86_400_000;
/** Покупка — как у аудитории «купившие» в рассылках. */
const DONE_STATUSES = ["delivered", "accepted", "in_production", "ready"];

export function defaultSimilar(): SimilarConfig {
  return {
    enabled: false,
    days: 7,
    text: "{name}, к вашей покупке могут пригодиться похожие материалы:",
  };
}

export function parseSimilar(raw: string | null | undefined): SimilarConfig {
  const d = defaultSimilar();
  if (!raw) return d;
  try {
    const p = JSON.parse(raw) as Partial<SimilarConfig>;
    const days = Number(p.days);
    return {
      enabled: p.enabled === true,
      days: Number.isInteger(days) && days >= 1 && days <= SIMILAR_MAX_DAYS ? days : d.days,
      text: typeof p.text === "string" && p.text.trim() ? p.text.trim().slice(0, 1000) : d.text,
    };
  } catch {
    return d;
  }
}

export async function loadSimilar(ctx: TenantContext): Promise<SimilarConfig> {
  return parseSimilar(await getSetting(ctx, SIMILAR_KEY));
}

export async function saveSimilar(ctx: TenantContext, cfg: SimilarConfig): Promise<void> {
  await setSetting(ctx, SIMILAR_KEY, JSON.stringify(parseSimilar(JSON.stringify(cfg))));
}

export function similarText(cfg: SimilarConfig, name: string | null): string {
  return cfg.text.replaceAll("{name}", name?.trim() || "Здравствуйте").trim();
}

export type CatalogItem = {
  id: string;
  name: string;
  category_id: string | null;
  category_ids: unknown;
  sort_order: number;
  stock_quantity: number | null;
};

function categoriesOf(p: CatalogItem): string[] {
  return productCategoryIds(p);
}

/** До трёх товаров из видимых категорий купленного, которых покупатель ещё не брал. */
export function pickSimilar(
  catalog: CatalogItem[],
  orderProductIds: string[],
  boughtIds: Set<string>,
  visible: Set<string>,
  limit = SIMILAR_PICKS,
): CatalogItem[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const cats = new Set(
    orderProductIds.flatMap((id) => {
      const p = byId.get(id);
      return p ? categoriesOf(p).filter((c) => visible.has(c)) : [];
    }),
  );
  if (!cats.size) return [];
  return catalog
    .filter(
      (p) =>
        !boughtIds.has(p.id) &&
        (p.stock_quantity == null || p.stock_quantity > 0) &&
        // Общая с покупкой категория, и она видна покупателю.
        categoriesOf(p).some((c) => cats.has(c) && visible.has(c)),
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export type SimilarRecipient = { telegramId: number; firstName: string | null; locale: string };
export type SimilarSender = (
  to: SimilarRecipient,
  text: string,
  products: Array<{ id: string; name: string }>,
) => Promise<boolean>;

/**
 * Сдвинуть курсор, только если его никто не сдвинул после нашего чтения.
 * Проигрыш гонки — обычное дело (второй запуск крона), не ошибка: в Sentry
 * не пишем.
 */
async function claimCursor(ctx: TenantContext, from: string | null, to: string): Promise<boolean> {
  const updated_at = new Date().toISOString();
  if (from == null) {
    const { error } = await ctx.db
      .from("app_settings")
      .insert({ bot_id: ctx.tenant.id, key: SIMILAR_CURSOR_KEY, value: to, updated_at });
    return !error;
  }
  const { data, error } = await ctx.db
    .from("app_settings")
    .update({ value: to, updated_at })
    .eq("key", SIMILAR_CURSOR_KEY)
    .eq("value", from)
    .select("key");
  return !error && Boolean(data?.length);
}

type DueOrder = { id: number; telegram_id: number; created_at: string };

export async function runSimilar(
  ctx: TenantContext,
  send: SimilarSender,
  now = new Date(),
): Promise<{ checked: number; sent: number; failed: number; skipped?: string }> {
  const r = { checked: 0, sent: 0, failed: 0 };
  if (!ctx.tenant.modules.winback) return { ...r, skipped: "module off" };
  const cfg = await loadSimilar(ctx);
  if (!cfg.enabled) return { ...r, skipped: "disabled" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const cap = await loadMarketingCap(ctx);

  const dueEdge = now.getTime() - cfg.days * DAY;
  const lateEdge = new Date(dueEdge - SIMILAR_LATE_DAYS * DAY).toISOString();
  const cursorRaw = await getSetting(ctx, SIMILAR_CURSOR_KEY);
  const cursor = Number(cursorRaw) || 0;

  // Заказы после курсора по порядку id; стоп на первом, чей срок не настал.
  let q = ctx.db
    .from("orders")
    .select("id, telegram_id, created_at")
    .in("status", DONE_STATUSES)
    .eq("platform", "telegram")
    .gt("id", cursor);
  // Первый запуск: историю не догоняем.
  if (!cursor) q = q.gte("created_at", lateEdge);
  const { data: scanned, error } = await q.order("id", { ascending: true }).limit(SCAN);
  if (error) throw serverFailure(`похожие материалы: заказы: ${error.message}`);
  const due: DueOrder[] = [];
  let next = cursor;
  for (const o of scanned ?? []) {
    if (Date.parse(o.created_at) > dueEdge) break;
    next = o.id;
    if (o.created_at >= lateEdge) due.push(o);
    if (due.length >= SIMILAR_BATCH) break;
  }
  // Захват: курсор сдвигаем до отправки и только если его не сдвинул
  // параллельный запуск. Упадём посередине — недошлём, но не повторим.
  if (next !== cursor && !(await claimCursor(ctx, cursorRaw, String(next))))
    return { ...r, skipped: "busy" };
  // Отложенные потолком в прошлые проходы — забираем все разом (тоже захватом).
  const deferred = (await takeDeferred(ctx)).filter((o) => o.created_at >= lateEdge);
  if (next === cursor && !deferred.length) return r;

  // Один заказ на покупателя — самый новый из пачки.
  const latest = new Map<number, DueOrder>();
  const postponed: DueOrder[] = [];
  for (const o of [...deferred, ...due]) {
    const id = Number(o.telegram_id);
    if (isRealTelegramChat(id) && (latest.get(id)?.id ?? 0) < o.id) latest.set(id, o);
  }
  if (!latest.size) return r;
  const ids = [...latest.keys()];

  const [{ data: users }, { data: blocked }, catalog, cats] = await Promise.all([
    ctx.db
      .from("bot_users")
      .select("user_key, telegram_id, first_name, opt_out, state")
      .eq("platform", "telegram")
      .in("telegram_id", ids),
    ctx.db.from("blocked_users").select("telegram_id").in("telegram_id", ids),
    pageAll(
      (from, to) =>
        ctx.db
          .from("products")
          .select("id, name, category_id, category_ids, sort_order, stock_quantity")
          .eq("is_active", true)
          .order("id")
          .range(from, to),
      "похожие материалы: каталог",
    ),
    pageAll(
      (from, to) =>
        ctx.db.from("categories").select("id, parent_id, is_visible").order("id").range(from, to),
      "похожие материалы: категории",
    ),
  ]);
  // Скрытый продавцом раздел (или его предок) — не предлагаем, как витрина и бот.
  const visible = visibleCategoryIds(cats);
  const blockedSet = new Set((blocked ?? []).map((b) => Number(b.telegram_id)));

  for (const u of users ?? []) {
    const telegramId = Number(u.telegram_id);
    const order = latest.get(telegramId);
    if (!order || u.opt_out || blockedSet.has(telegramId)) continue;
    r.checked++;
    // Всё, что покупатель уже брал, — не предлагаем.
    const theirOrders = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("id")
          .eq("telegram_id", telegramId)
          .in("status", DONE_STATUSES)
          .order("id")
          .range(from, to),
      "похожие материалы: заказы покупателя",
    );
    // Есть заказ новее — напишем по нему в свой срок, а не дважды.
    if (theirOrders.some((o) => o.id > order.id)) continue;
    const items = await pageAll(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select("order_id, product_id")
          .in(
            "order_id",
            theirOrders.map((o) => o.id),
          )
          .order("order_id")
          .order("id")
          .range(from, to),
      "похожие материалы: купленное",
    );
    const bought = new Set(items.map((i) => String(i.product_id)));
    const inOrder = items
      .filter((i) => Number(i.order_id) === order.id)
      .map((i) => String(i.product_id));
    const picks = pickSimilar(catalog as CatalogItem[], inOrder, bought, visible);
    if (!picks.length) continue;
    // Потолок маркетинговых сообщений за сутки (core/marketing/cap).
    const state = stateFromJson(u.state);
    if (!(await claimMarketing(ctx, u.user_key, u.state, cap, now))) {
      // Место занято другим сообщением: заказ откладываем, а не теряем —
      // курсор его уже прошёл. Отложенное живёт до края опоздания (N + 3 дня).
      postponed.push(order);
      continue;
    }
    const ok = await send(
      {
        telegramId,
        firstName: u.first_name,
        locale: typeof state.locale === "string" ? state.locale : "ru",
      },
      similarText(cfg, u.first_name),
      picks.map((p) => ({ id: p.id, name: p.name })),
    ).catch(() => false);
    if (ok) r.sent++;
    else r.failed++;
  }
  if (postponed.length) await addDeferred(ctx, postponed);
  return r;
}

/**
 * Отложенные потолком заказы — строка app_settings `similar_materials:deferred`
 * (JSON-массив, не больше SIMILAR_BATCH × 4). Меняется только условной
 * записью по прежнему значению: два прохода не заберут одно и то же.
 */
export const SIMILAR_DEFERRED_KEY = "similar_materials:deferred";
const DEFERRED_MAX = SIMILAR_BATCH * 4;

function parseDeferred(raw: string | null): DueOrder[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (o): o is DueOrder =>
        !!o &&
        typeof o === "object" &&
        Number.isSafeInteger((o as DueOrder).id) &&
        Number.isSafeInteger((o as DueOrder).telegram_id) &&
        typeof (o as DueOrder).created_at === "string",
    );
  } catch {
    return [];
  }
}

async function readDeferred(ctx: TenantContext): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", SIMILAR_DEFERRED_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`похожие материалы: отложенные: ${error.message}`);
  return data ? (data.value ?? "") : null;
}

/** Условно заменить значение; строки ещё нет — создать. */
async function swapDeferred(ctx: TenantContext, from: string | null, to: string): Promise<boolean> {
  const updated_at = new Date().toISOString();
  if (from == null) {
    const { error } = await ctx.db
      .from("app_settings")
      .insert({ bot_id: ctx.tenant.id, key: SIMILAR_DEFERRED_KEY, value: to, updated_at });
    return !error;
  }
  const { data, error } = await ctx.db
    .from("app_settings")
    .update({ value: to, updated_at })
    .eq("key", SIMILAR_DEFERRED_KEY)
    .eq("value", from)
    .select("key");
  return !error && Boolean(data?.length);
}

async function takeDeferred(ctx: TenantContext): Promise<DueOrder[]> {
  const raw = await readDeferred(ctx);
  const list = parseDeferred(raw);
  if (!list.length) return [];
  return (await swapDeferred(ctx, raw, "[]")) ? list : [];
}

async function addDeferred(ctx: TenantContext, orders: DueOrder[]): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const raw = await readDeferred(ctx);
    const have = parseDeferred(raw);
    const ids = new Set(have.map((o) => o.id));
    const next = [...have, ...orders.filter((o) => !ids.has(o.id))].slice(-DEFERRED_MAX);
    if (await swapDeferred(ctx, raw, JSON.stringify(next))) return;
  }
  console.error(`[similar:${ctx.tenant.id}] отложенные не записались: ${orders.length}`);
}
