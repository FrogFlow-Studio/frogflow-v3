import { BUNDLE_MAX_ITEMS, BUNDLE_MAX_QTY } from "@/core/bundles/limits";
import { pageAll } from "@/core/db/page";
import { UserError } from "@/core/i18n/user-error";
import { getSettingStrict, updateSettingStamped } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";

/**
 * Набор товаров (модуль `bundles`): «шампунь + бальзам со скидкой». Набор —
 * обычный физический товар со своей ценой, а состав лежит отдельной записью
 * app_settings `bundle:<id товара-набора>` = {"items":[{"p":<id товара>,
 * "v":<id варианта|отсутствует>,"q":<штук>}]}. Своей таблицы нет (схему не
 * меняем). Пустая строка — «это не набор».
 *
 * Правила: набор не входит в набор (ни своим составом, ни как компонент);
 * компонентом может быть только физический товар, у товара с вариантами
 * вариант выбирается обязательно. Удалённый или скрытый компонент делает
 * набор недоступным — продавец видит пометку, покупатель набор не получает.
 * Остаток и списание набора — core/bundles/stock (Н2).
 */
export const BUNDLE_PREFIX = "bundle:";
export { BUNDLE_MAX_ITEMS, BUNDLE_MAX_QTY };

export type BundleItem = { productId: string; variantId: string | null; qty: number };

const bundleKey = (productId: string) => `${BUNDLE_PREFIX}${productId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Состав из записи; мусор и повторы отбрасываются, повтор складывает штуки. */
export function parseBundle(raw: string | null | undefined): BundleItem[] | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { items?: unknown } | null;
    if (!j || !Array.isArray(j.items)) return null;
    const out: BundleItem[] = [];
    for (const it of j.items) {
      const o = it as { p?: unknown; v?: unknown; q?: unknown } | null;
      const q = Number(o?.q);
      if (!o || typeof o.p !== "string" || !UUID.test(o.p)) continue;
      if (!Number.isInteger(q) || q < 1) continue;
      const variantId = typeof o.v === "string" && UUID.test(o.v) ? o.v : null;
      addItem(out, { productId: o.p, variantId, qty: Math.min(q, BUNDLE_MAX_QTY) });
    }
    return out.length ? out.slice(0, BUNDLE_MAX_ITEMS) : null;
  } catch {
    return null;
  }
}

function addItem(list: BundleItem[], it: BundleItem): void {
  const same = list.find((x) => x.productId === it.productId && x.variantId === it.variantId);
  if (same) same.qty = Math.min(BUNDLE_MAX_QTY, same.qty + it.qty);
  else list.push(it);
}

/** Тот же состав без повторов: одинаковые «товар + вариант» складываются. */
export function mergeItems(items: readonly BundleItem[]): BundleItem[] {
  const out: BundleItem[] = [];
  for (const it of items) addItem(out, { ...it });
  return out;
}

function serialize(items: readonly BundleItem[]): string {
  if (!items.length) return "";
  return JSON.stringify({
    items: items.map((i) => ({
      p: i.productId,
      ...(i.variantId ? { v: i.variantId } : {}),
      q: i.qty,
    })),
  });
}

export async function loadBundle(
  ctx: TenantContext,
  productId: string,
): Promise<BundleItem[] | null> {
  return parseBundle(await getSettingStrict(ctx, bundleKey(productId)));
}

/** Все наборы магазина: id набора → состав. Постранично: у крупного магазина их много. */
export async function listBundles(ctx: TenantContext): Promise<Map<string, BundleItem[]>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key, value")
        .eq("bot_id", ctx.tenant.id)
        .like("key", `${BUNDLE_PREFIX}%`)
        .order("key")
        .range(from, to),
    "Наборы товаров",
  );
  const out = new Map<string, BundleItem[]>();
  for (const r of rows) {
    const items = parseBundle(r.value);
    if (items) out.set(r.key.slice(BUNDLE_PREFIX.length), items);
  }
  return out;
}

type ComponentRow = {
  id: string;
  name: string;
  price: number;
  currency: string;
  country_prices: unknown;
  category_ids: unknown;
  is_active: boolean;
  fulfillment_kind: string;
  product_variants: Array<{ id: string; name: string; price: number }> | null;
};

async function readProducts(
  ctx: TenantContext,
  ids: readonly string[],
): Promise<Map<string, ComponentRow>> {
  const rows = await inChunks(
    ids,
    (chunk) =>
      ctx.db
        .from("products")
        .select(
          "id, name, price, currency, country_prices, category_ids, is_active, fulfillment_kind, product_variants(id, name, price)",
        )
        .in("id", chunk) as unknown as PromiseLike<{
        data: ComponentRow[] | null;
        error: { message: string } | null;
      }>,
    "Набор: товары состава",
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Сохранить состав набора. `items` пустой или null — товар перестаёт быть набором.
 * Запись условная по метке времени (updateSettingStamped): две вкладки не затирают друг друга.
 */
export async function saveBundle(
  ctx: TenantContext,
  productId: string,
  items: readonly BundleItem[] | null,
): Promise<BundleItem[] | null> {
  const clean = items ? mergeItems(items) : [];
  if (clean.length > BUNDLE_MAX_ITEMS)
    throw new UserError("err.bundle.tooMany", "В наборе не больше {n} позиций.", {
      n: BUNDLE_MAX_ITEMS,
    });
  if (clean.length) {
    for (const i of clean)
      if (!Number.isInteger(i.qty) || i.qty < 1 || i.qty > BUNDLE_MAX_QTY)
        throw new UserError("err.bundle.badQty", "Количество в наборе — целое от 1 до {n}.", {
          n: BUNDLE_MAX_QTY,
        });
    const all = await listBundles(ctx);
    // Набор в наборе — отказ: и если компонент сам набор, и если этот товар уже чей-то компонент.
    for (const i of clean)
      if (i.productId === productId || all.has(i.productId))
        throw new UserError("err.bundle.nested", "Набор не может входить в набор.");
    for (const [id, list] of all)
      if (id !== productId && list.some((i) => i.productId === productId))
        throw new UserError(
          "err.bundle.nestedIn",
          "Этот товар уже входит в другой набор — набор не может входить в набор.",
        );
    const self = (await readProducts(ctx, [productId])).get(productId);
    if (!self) throw new UserError("err.bundle.noProduct", "Товар не найден.");
    if (self.fulfillment_kind !== "physical")
      throw new UserError(
        "err.bundle.notPhysical",
        "Набор — физический товар: в карточке выберите «Физический».",
      );
    const products = await readProducts(
      ctx,
      clean.map((i) => i.productId),
    );
    for (const i of clean) {
      const p = products.get(i.productId);
      if (!p) throw new UserError("err.bundle.noProduct", "Товар не найден.");
      if (p.fulfillment_kind !== "physical")
        throw new UserError(
          "err.bundle.componentNotPhysical",
          "В набор входят только физические товары: «{name}» — не физический.",
          { name: p.name },
        );
      const variants = p.product_variants ?? [];
      if (i.variantId && !variants.some((v) => v.id === i.variantId))
        throw new UserError("err.bundle.noVariant", "Вариант товара «{name}» не найден.", {
          name: p.name,
        });
      if (!i.variantId && variants.length)
        throw new UserError(
          "err.bundle.variantRequired",
          "У товара «{name}» есть варианты — выберите вариант для набора.",
          { name: p.name },
        );
    }
  }
  const r = await updateSettingStamped(ctx, bundleKey(productId), () => serialize(clean));
  if (r === "failed") throw serverFailure("Набор товаров: состав не записался");
  return clean.length ? clean : null;
}

/** Перенос состава в копию товара (copy.ts). */
export async function copyBundle(ctx: TenantContext, from: string, to: string): Promise<void> {
  const raw = await getSettingStrict(ctx, bundleKey(from));
  if (!parseBundle(raw)) return;
  const r = await updateSettingStamped(ctx, bundleKey(to), () => raw);
  if (r === "failed") throw serverFailure("Копия товара: состав набора не записался");
}

/** Состав удалённого товара-набора больше никому не нужен. Сбой чистки не ломает удаление. */
export async function dropBundle(ctx: TenantContext, productId: string): Promise<void> {
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .eq("bot_id", ctx.tenant.id)
    .eq("key", bundleKey(productId));
  if (error) console.error(`[bundles] состав набора ${productId} не удалён`, error.message);
}

export type ComponentState = "ok" | "hidden" | "deleted" | "noVariant";

export type ComponentView = BundleItem & {
  name: string | null;
  variantName: string | null;
  state: ComponentState;
  /** Цена штуки с учётом акций; null — компонент недоступен или валюта не сходится. */
  unitPrice: number | null;
};

export type BundleView = {
  items: ComponentView[];
  /** Все компоненты в продаже: иначе набор покупателю недоступен. */
  available: boolean;
  /** Сколько стоят составляющие по отдельности; null — цены не сопоставить. */
  separateTotal: number | null;
  /** Выгода покупателя, ₸ (0 и меньше — набор не дешевле); null — не посчитать. */
  saving: number | null;
  bundlePrice: number;
  currency: string;
  /** Сколько наборов собирается из остатка составляющих (Н2); null — предела нет. */
  stock: number | null;
};

/** Выгода набора по готовым ценам штук: чистая арифметика, цены уже с акциями. */
export function bundleSaving(
  bundlePrice: number,
  parts: ReadonlyArray<{ unitPrice: number | null; qty: number }>,
): { separateTotal: number; saving: number } | null {
  if (!parts.length || parts.some((p) => p.unitPrice == null)) return null;
  const separateTotal = parts.reduce((s, p) => s + (p.unitPrice as number) * p.qty, 0);
  return { separateTotal, saving: separateTotal - bundlePrice };
}

/**
 * Состав набора с состоянием каждой позиции и выгодой по текущим ценам
 * (акции — через resolvePrice, как у покупателя). Не набор — null.
 */
export async function bundleView(
  ctx: TenantContext,
  productId: string,
  preloaded?: readonly BundleItem[] | null,
): Promise<BundleView | null> {
  const items = preloaded === undefined ? await loadBundle(ctx, productId) : preloaded;
  if (!items) return null;
  const products = await readProducts(ctx, [productId, ...items.map((i) => i.productId)]);
  const self = products.get(productId);
  if (!self) return null;
  const { resolvePrice } = await import("@/core/pricing/pricing");
  const priced = async (p: ComponentRow, v?: { price: number }) =>
    resolvePrice(
      ctx,
      {
        id: p.id,
        price: p.price,
        currency: p.currency,
        country_prices: p.country_prices as never,
        category_ids: p.category_ids as never,
      },
      null,
      v ?? null,
    );
  const own = await priced(self);
  const views: ComponentView[] = [];
  let currencyOk = true;
  for (const it of items) {
    const p = products.get(it.productId);
    const variant = it.variantId ? p?.product_variants?.find((v) => v.id === it.variantId) : null;
    const state: ComponentState = !p
      ? "deleted"
      : !p.is_active
        ? "hidden"
        : (it.variantId && !variant) || (!it.variantId && (p.product_variants ?? []).length)
          ? "noVariant"
          : "ok";
    let unitPrice: number | null = null;
    if (p && state === "ok") {
      const m = await priced(p, variant ?? undefined);
      if (m.currency === own.currency) unitPrice = m.amount;
      else currencyOk = false;
    }
    views.push({
      ...it,
      name: p?.name ?? null,
      variantName: variant?.name ?? null,
      state,
      unitPrice,
    });
  }
  const sums = currencyOk ? bundleSaving(own.amount, views) : null;
  return {
    items: views,
    available: views.every((v) => v.state === "ok"),
    separateTotal: sums?.separateTotal ?? null,
    saving: sums?.saving ?? null,
    bundlePrice: own.amount,
    currency: own.currency,
    stock: ctx.tenant.modules.stock
      ? await (await import("@/core/bundles/stock")).bundleStock(ctx, items)
      : null,
  };
}

export type ComponentInfo = {
  id: string;
  name: string;
  physical: boolean;
  variants: Array<{ id: string; name: string }>;
};

/** Товар для формы набора: физический ли он и какие у него варианты. */
export async function bundleComponentInfo(
  ctx: TenantContext,
  productId: string,
): Promise<ComponentInfo | null> {
  const p = (await readProducts(ctx, [productId])).get(productId);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    physical: p.fulfillment_kind === "physical",
    variants: (p.product_variants ?? []).map((v) => ({ id: v.id, name: v.name })),
  };
}
