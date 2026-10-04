import { pageAll } from "@/core/db/page";
import { isGiftWrapRow } from "@/core/orders/gift-wrap";
import { shopCurrency } from "@/core/discounts/discounts";
import { UserError } from "@/core/i18n/user-error";
import { getSettingStrict, updateSettingStamped } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";

/**
 * Себестоимость товара (модуль `profit`): app_settings `cost:<id товара>` =
 * {"p": число|отсутствует, "v": {"<название варианта>": число}, "cur": "KZT"}.
 * Своей колонки нет (схему не меняем). Вариант ищется по названию, не по id:
 * при каждом сохранении товара варианты пересоздаются с новыми id
 * (setProductVariants), а название переживает пересохранение. Переименовали
 * вариант — себестоимость у него снова не задана. Пусто — «не задана», а не 0: ноль —
 * осознанная себестоимость (подарок, цифровой товар без затрат). Деньги
 * хранятся в валюте магазина на момент записи (`cur`): если валюту магазина
 * потом сменили, прежняя себестоимость считается не заданной, а не
 * пересчитывается по чужому курсу.
 *
 * Пишется условным обновлением по метке времени (updateSettingStamped) и
 * слиянием: две вкладки правят разные поля, и обе правки сохраняются.
 */
export const COST_PREFIX = "cost:";
export const COST_MAX = 1_000_000_000;

export type ProductCost = {
  /** Себестоимость товара (и вариантов без своей); null — не задана. */
  price: number | null;
  /** Название варианта → его себестоимость; нет ключа — у варианта своей нет. */
  variants: Record<string, number>;
  currency: string;
};

const money = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= COST_MAX
    ? Math.round(v * 100) / 100
    : null;

export function parseCost(raw: string | null | undefined): ProductCost | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { p?: unknown; v?: unknown; cur?: unknown } | null;
    if (!j || typeof j !== "object") return null;
    const variants: Record<string, number> = {};
    if (j.v && typeof j.v === "object")
      for (const [id, n] of Object.entries(j.v as Record<string, unknown>)) {
        const m = money(n);
        if (m !== null) variants[id] = m;
      }
    const price = money(j.p);
    if (price === null && !Object.keys(variants).length) return null;
    return {
      price,
      variants,
      currency: typeof j.cur === "string" && j.cur ? j.cur.toUpperCase() : "KZT",
    };
  } catch {
    return null;
  }
}

function serialize(c: ProductCost): string {
  if (c.price === null && !Object.keys(c.variants).length) return "";
  return JSON.stringify({
    ...(c.price === null ? {} : { p: c.price }),
    v: c.variants,
    cur: c.currency,
  });
}

/** Себестоимость позиции: у варианта своя, иначе товара; null — не задана. */
export function unitCost(c: ProductCost | null, variantName: string | null): number | null {
  if (!c) return null;
  const key = variantName?.trim();
  if (key && c.variants[key] !== undefined) return c.variants[key]!;
  return c.price;
}

/**
 * Себестоимость штуки позиции заказа. Вариант определяется по id (его название
 * передаёт вызывающий), а если id обнулён пересохранением товара — по названию
 * позиции «Товар (Вариант)». Вариантная позиция, чей вариант не найден, —
 * null («не задана»), а не цена товара.
 */
export function itemUnitCost(
  c: ProductCost | null,
  item: { variantId: string | null; variantName: string | null; nameSnapshot: string | null },
): number | null {
  // Подарочная упаковка — позиция без товара: себестоимость учтена в цене, у неё нет «не задана».
  if (isGiftWrapRow(item.nameSnapshot)) return 0;
  if (!c) return null;
  const hasVariants = Object.keys(c.variants).length > 0;
  if (item.variantName !== null) return unitCost(c, item.variantName);
  const name = item.nameSnapshot ?? "";
  for (const key of Object.keys(c.variants)) {
    if (name.endsWith(` (${key})`)) return c.variants[key]!;
  }
  const looksVariant = item.variantId !== null || /\([^()]+\)\s*$/.test(name);
  if (hasVariants && looksVariant) return null;
  return c.price;
}

export async function loadCost(ctx: TenantContext, productId: string): Promise<ProductCost | null> {
  return parseCost(await getSettingStrict(ctx, `${COST_PREFIX}${productId}`));
}

/** Себестоимость всех товаров магазина: id товара → запись. Постранично, по ключу. */
export async function listCosts(ctx: TenantContext): Promise<Map<string, ProductCost>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .eq("bot_id", ctx.tenant.id)
        .like("key", `${COST_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Себестоимость товаров",
  );
  const out = new Map<string, ProductCost>();
  for (const r of rows) {
    const c = parseCost(r.value);
    if (c) out.set(r.key.slice(COST_PREFIX.length), c);
  }
  return out;
}

export type CostPatch = {
  /** undefined — не трогать, null — стереть. */
  price?: number | null;
  /** Название варианта → число или null (стереть); отсутствующие не трогаются. */
  variants?: Record<string, number | null>;
};

/**
 * Записать правку себестоимости. Товар и варианты проверяются по базе: чужой
 * id или удалённый вариант отвергаются. Сбой чтения — serverFailure, а не
 * «нет вариантов».
 */
export async function saveCost(
  ctx: TenantContext,
  productId: string,
  patch: CostPatch,
): Promise<ProductCost | null> {
  const prod = await ctx.db.from("products").select("id").eq("id", productId).maybeSingle();
  if (prod.error) throw serverFailure(`Товар для себестоимости: ${prod.error.message}`);
  if (!prod.data) throw new UserError("err.cost.noProduct", "Товар не найден.");
  // Варианты товара сейчас: сверху проверка названий, ниже — чистка записей переименованных.
  const vs = await pageAll<{ name: string }>(
    (from, to) =>
      ctx.db
        .from("product_variants")
        .select("name")
        .eq("product_id", productId)
        .order("id")
        .range(from, to),
    "Варианты для себестоимости",
  );
  const known = new Set(vs.map((v) => v.name.trim()));
  if (Object.keys(patch.variants ?? {}).some((n) => !known.has(n.trim())))
    throw new UserError("err.cost.noVariant", "Вариант товара не найден.");
  const bad = [patch.price, ...Object.values(patch.variants ?? {})].some(
    (v) => v !== undefined && v !== null && money(v) === null,
  );
  if (bad)
    throw new UserError("err.cost.badAmount", "Себестоимость — число от 0 до 1 000 000 000.");
  const cur = await shopCurrency(ctx);
  let result: ProductCost | null = null;
  const r = await updateSettingStamped(ctx, `${COST_PREFIX}${productId}`, (raw) => {
    const prev = parseCost(raw);
    // Другая валюта — прежние суммы не переносим: чужие цифры под новым знаком хуже пустых.
    const base: ProductCost =
      prev && prev.currency === cur
        ? { ...prev, variants: { ...prev.variants } }
        : { price: null, variants: {}, currency: cur };
    if (patch.price !== undefined) base.price = money(patch.price);
    for (const [name, v] of Object.entries(patch.variants ?? {})) {
      const m = money(v);
      if (m === null) delete base.variants[name.trim()];
      else base.variants[name.trim()] = m;
    }
    // Вариант удалили или переименовали — его сумма больше никому не принадлежит.
    for (const name of Object.keys(base.variants)) if (!known.has(name)) delete base.variants[name];
    result = base.price === null && !Object.keys(base.variants).length ? null : base;
    return serialize(base);
  });
  if (r === "failed")
    throw new UserError(
      "err.settings.saveFailed",
      "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
    );
  return result;
}

export type CostRow = {
  id: string;
  name: string;
  price: number;
  /** Валюта цены товара. */
  currency: string;
  active: boolean;
  variants: Array<{ name: string; price: number }>;
  /** Заданная себестоимость; null — не задана (или записана в другой валюте магазина). */
  cost: ProductCost | null;
};

/** Все товары магазина с их себестоимостью — для страницы «Себестоимость». */
export async function listCostRows(
  ctx: TenantContext,
): Promise<{ currency: string; rows: CostRow[]; staleCurrency: number }> {
  const currency = await shopCurrency(ctx);
  const [products, variants, costs] = await Promise.all([
    pageAll<{
      id: string;
      name: string;
      price: number;
      currency: string;
      is_active: boolean;
    }>(
      (from, to) =>
        ctx.db
          .from("products")
          .select("id, name, price, currency, is_active")
          .order("sort_order")
          .order("id")
          .range(from, to),
      "Товары для себестоимости",
    ),
    pageAll<{ id: string; product_id: string; name: string; price: number; sort_order: number }>(
      (from, to) =>
        ctx.db
          .from("product_variants")
          .select("id, product_id, name, price, sort_order")
          .order("product_id")
          .order("sort_order")
          .order("id")
          .range(from, to),
      "Варианты для себестоимости",
    ),
    listCosts(ctx),
  ]);
  const byProduct = new Map<string, CostRow["variants"]>();
  for (const v of variants) {
    const list = byProduct.get(v.product_id) ?? [];
    list.push({ name: v.name.trim(), price: v.price });
    byProduct.set(v.product_id, list);
  }
  let staleCurrency = 0;
  const rows = products.map((p): CostRow => {
    const c = costs.get(p.id) ?? null;
    const stale = c !== null && c.currency !== currency;
    if (stale) staleCurrency++;
    return {
      id: p.id,
      name: p.name,
      price: p.price,
      currency: p.currency,
      active: p.is_active,
      variants: byProduct.get(p.id) ?? [],
      cost: stale ? null : c,
    };
  });
  return { currency, rows, staleCurrency };
}

/**
 * Поле суммы из формы: пусто — null («не задана»), «12,5» — 12.5, мусор и
 * отрицательные — "invalid" (поле подсвечивается, не сохраняется).
 */
export function parseAmountInput(raw: string): number | null | "invalid" {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "invalid";
  const n = Number(s);
  return n <= COST_MAX ? n : "invalid";
}

/** Копия товара наследует себестоимость (варианты ищутся по названию, оно не меняется). */
export async function copyCost(ctx: TenantContext, from: string, to: string): Promise<void> {
  const raw = await getSettingStrict(ctx, `${COST_PREFIX}${from}`);
  if (!parseCost(raw)) return;
  const r = await updateSettingStamped(ctx, `${COST_PREFIX}${to}`, () => raw);
  if (r === "failed") throw serverFailure("Копия товара: себестоимость не записалась");
}
