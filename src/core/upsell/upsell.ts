import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, getSettingsStrict } from "@/core/settings/settings";
import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";

/**
 * Апсейл и кросс-сейл (модуль upsell): в корзине — «С этим берут» до трёх
 * товаров. Источник — правила продавца «товар → что предлагать»
 * (`app_settings.upsell_rules`, JSON `{productId: [ids]}`); если правил для
 * корзины нет — популярные товары из тех же категорий. Предлагаем только то,
 * что в продаже, есть на складе и ещё не в корзине.
 */
export const UPSELL_KEY = "upsell_rules";
export const UPSELL_MAX = 3;
/** Сколько популярных товаров смотрим для «из тех же категорий». */
const POPULAR_SCAN = 500;

export type UpsellRules = Record<string, string[]>;

export function parseRules(raw: string | null | undefined): UpsellRules {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: UpsellRules = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>))
      if (Array.isArray(v))
        out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 10);
    return out;
  } catch {
    return {};
  }
}

/** Кандидаты из правил: по порядку товаров корзины, без повторов и без того, что уже в корзине. */
export function fromRules(
  cartIds: readonly string[],
  rules: UpsellRules,
  limit = UPSELL_MAX,
): string[] {
  const inCart = new Set(cartIds);
  const out: string[] = [];
  for (const id of cartIds)
    for (const s of rules[id] ?? [])
      if (!inCart.has(s) && !out.includes(s)) {
        out.push(s);
        if (out.length >= limit) return out;
      }
  return out;
}

export type UpsellProduct = { id: string; name: string; price: number; currency: string };

type Row = {
  id: string;
  name: string;
  price: number;
  currency: string;
  category_ids: unknown;
  stock_quantity: number | null;
  rating_count: number | null;
  fulfillment_kind: string;
};

export async function upsellFor(
  ctx: TenantContext,
  cartIds: readonly string[],
  limit = UPSELL_MAX,
): Promise<UpsellProduct[]> {
  if (!ctx.tenant.modules.upsell || cartIds.length === 0) return [];
  const rules = parseRules(await getSetting(ctx, UPSELL_KEY));
  const cols =
    "id, name, price, currency, category_ids, stock_quantity, rating_count, fulfillment_kind";
  // Товары корзины и из правил — по id: у крупного каталога они могли не
  // попасть в общую выборку, и правило продавца молча не срабатывало.
  // Для запасного «из тех же категорий» хватает самых популярных.
  const named = [...new Set([...cartIds, ...fromRules(cartIds, rules, 20)])];
  const [explicit, popular] = await Promise.all([
    ctx.db.from("products").select(cols).eq("is_active", true).in("id", named),
    ctx.db
      .from("products")
      .select(cols)
      .eq("is_active", true)
      .order("rating_count", { ascending: false, nullsFirst: false })
      .order("id")
      .limit(POPULAR_SCAN),
  ]);
  // Сбой чтения — не «предлагать нечего»: наружу serverFailure.
  if (explicit.error) throw serverFailure(`Апсейл: товары правил: ${explicit.error.message}`);
  if (popular.error) throw serverFailure(`Апсейл: популярные: ${popular.error.message}`);
  const rows = [
    ...new Map(
      [...(explicit.data ?? []), ...(popular.data ?? [])].map((r) => [r.id, r as Row]),
    ).values(),
  ];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const inCart = new Set(cartIds);
  const stockOn = ctx.tenant.modules.stock;
  const kinds = new Set(cartIds.map((id) => byId.get(id)?.fulfillment_kind).filter(Boolean));
  const ok = (r: Row | undefined): r is Row =>
    Boolean(r) &&
    !inCart.has(r!.id) &&
    !(stockOn && r!.stock_quantity != null && r!.stock_quantity <= 0) &&
    // Цифровое и физическое оформляются отдельно — не предлагаем смешать корзину.
    (kinds.size === 0 || kinds.has(r!.fulfillment_kind));
  const picked = fromRules(cartIds, rules, 20)
    .map((id) => byId.get(id))
    .filter(ok);
  if (picked.length < limit) {
    const cats = new Set(
      cartIds.flatMap((id) => {
        const c = byId.get(id)?.category_ids;
        return Array.isArray(c) ? (c as string[]) : [];
      }),
    );
    const same = rows
      .filter(
        (r) =>
          ok(r) &&
          !picked.some((p) => p.id === r.id) &&
          Array.isArray(r.category_ids) &&
          (r.category_ids as string[]).some((c) => cats.has(c)),
      )
      .sort((a, b) => (b.rating_count ?? 0) - (a.rating_count ?? 0));
    picked.push(...same);
  }
  return picked.slice(0, limit).map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    currency: r.currency,
  }));
}

export async function getUpsellFor(ctx: TenantContext, productId: string): Promise<string[]> {
  return parseRules(await getSetting(ctx, UPSELL_KEY))[productId] ?? [];
}

export async function setUpsellFor(
  ctx: TenantContext,
  productId: string,
  ids: string[],
): Promise<void> {
  const clean = Array.from(new Set(ids.filter((x) => x !== productId))).slice(0, 10);
  const ok = await writeRules(ctx, (rules) => {
    if (clean.length) rules[productId] = clean;
    else delete rules[productId];
    return rules;
  });
  if (!ok)
    throw serverFailure("Апсейл: правила не сохранены (правила только что изменил кто-то другой)");
}

/**
 * Запись правил: читаем строку вместе с updated_at и пишем только если он не
 * сменился (условие на короткое поле: весь JSON правил в адрес запроса не
 * кладём, у большого каталога он длиннее предела и дал бы 431). Проиграли
 * гонку — читаем заново; `mutate` вернул null — ничего не пишем.
 */
async function writeRules(
  ctx: TenantContext,
  mutate: (rules: UpsellRules) => UpsellRules | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await ctx.db
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", UPSELL_KEY)
      .maybeSingle();
    if (error) throw serverFailure(`Апсейл: правила: ${error.message}`);
    const next = mutate(parseRules(data?.value));
    if (!next) return true;
    const value = JSON.stringify(next);
    const updated_at = new Date().toISOString();
    if (!data) {
      const ins = await ctx.db
        .from("app_settings")
        .insert({ bot_id: ctx.tenant.id, key: UPSELL_KEY, value, updated_at });
      if (!ins.error) return true;
      if (ins.error.code !== "23505") throw serverFailure(`Апсейл: правила: ${ins.error.message}`);
      continue;
    }
    const q = ctx.db.from("app_settings").update({ value, updated_at }).eq("key", UPSELL_KEY);
    const { data: written, error: writeError } = await (
      data.updated_at == null ? q.is("updated_at", null) : q.eq("updated_at", data.updated_at)
    ).select("key");
    if (writeError) throw serverFailure(`Апсейл: правила: ${writeError.message}`);
    if (written?.length) return true;
  }
  return false;
}

/** Состояние товара из правила: в продаже, скрыт (is_active = false) или удалён. */
export type UpsellState = "ok" | "hidden" | "deleted";
export type UpsellTarget = { id: string; name: string | null; state: UpsellState };
export type UpsellProblem = {
  productId: string;
  productName: string | null;
  /** Товар, к которому привязано правило: удалён — правило не сработает никогда. */
  trigger: UpsellState;
  /** Предлагаемые товары, которые покупатель не увидит (скрыты или удалены). */
  dead: UpsellTarget[];
};

async function productStates(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<Map<string, { name: string | null; state: UpsellState }>> {
  const rows = await inChunks(
    ids,
    (chunk) => ctx.db.from("products").select("id, name, is_active").in("id", chunk),
    "Апсейл: товары",
  );
  const out = new Map<string, { name: string | null; state: UpsellState }>(
    ids.map((id) => [id, { name: null, state: "deleted" }]),
  );
  for (const r of rows) out.set(r.id, { name: r.name, state: r.is_active ? "ok" : "hidden" });
  return out;
}

/**
 * Правила, которые больше не работают: предлагаемый товар скрыт или удалён
 * (cart-апсейл берёт только товары в продаже), либо удалён сам товар, к
 * которому правило привязано. Правило без таких мест в список не попадает.
 */
export async function upsellHealth(
  ctx: TenantContext,
): Promise<{ rules: number; problems: UpsellProblem[] }> {
  const rules = parseRules((await getSettingsStrict(ctx, [UPSELL_KEY]))[UPSELL_KEY]);
  const ids = [...new Set(Object.entries(rules).flatMap(([k, v]) => [k, ...v]))];
  const states = await productStates(ctx, ids);
  const problems: UpsellProblem[] = [];
  for (const [productId, targets] of Object.entries(rules)) {
    const self = states.get(productId)!;
    const dead = targets.map((id) => ({ id, ...states.get(id)! })).filter((t) => t.state !== "ok");
    if (self.state === "deleted" || dead.length)
      problems.push({ productId, productName: self.name, trigger: self.state, dead });
  }
  problems.sort(
    (a, b) =>
      (a.productName ?? "").localeCompare(b.productName ?? "") ||
      (a.productId < b.productId ? -1 : 1),
  );
  return { rules: Object.keys(rules).length, problems };
}

/** Выбранные для товара предложения вместе с состоянием каждого (для редактора товара). */
export async function upsellTargets(
  ctx: TenantContext,
  productId: string,
): Promise<UpsellTarget[]> {
  const selected = await getUpsellFor(ctx, productId);
  const states = await productStates(ctx, selected);
  return selected.map((id) => ({ id, ...states.get(id)! }));
}

/**
 * «Убрать правила на удалённые товары»: из предложений уходят удалённые товары,
 * правила удалённых товаров — целиком. Скрытые не трогаем: скрытый товар могут
 * вернуть, и правило снова заработает. Возвращает, сколько записей убрано.
 */
export async function pruneUpsellRules(ctx: TenantContext): Promise<number> {
  const { problems } = await upsellHealth(ctx);
  const gone = new Set(
    problems.flatMap((p) => p.dead.filter((d) => d.state === "deleted").map((d) => d.id)),
  );
  const orphans = new Set(problems.filter((p) => p.trigger === "deleted").map((p) => p.productId));
  if (!gone.size && !orphans.size) return 0;
  let removed = 0;
  const ok = await writeRules(ctx, (rules) => {
    removed = 0;
    for (const key of Object.keys(rules)) {
      if (orphans.has(key)) {
        removed += 1;
        delete rules[key];
        continue;
      }
      const keep = rules[key]!.filter((id) => !gone.has(id));
      removed += rules[key]!.length - keep.length;
      if (keep.length) rules[key] = keep;
      else delete rules[key];
    }
    return removed ? rules : null;
  });
  if (!ok)
    throw serverFailure("Апсейл: правила не очищены (правила только что изменил кто-то другой)");
  return removed;
}
