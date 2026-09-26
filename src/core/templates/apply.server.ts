import { createCategory, createProduct } from "@/core/catalog/admin";
import { UserError } from "@/core/i18n/user-error";
import { getSetting, setSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { EXAMPLE_PREFIX, NICHE_TEMPLATES, templateLang } from "./niches";

const APPLIED_KEY = "niche_template_applied";

/** Шаблон можно положить только в пустой магазин: ни товаров, ни категорий. */
export async function templateAvailable(ctx: TenantContext): Promise<boolean> {
  const [{ count: products }, { count: categories }] = await Promise.all([
    ctx.db.from("products").select("id", { count: "exact", head: true }),
    ctx.db.from("categories").select("id", { count: "exact", head: true }),
  ]);
  return (products ?? 0) === 0 && (categories ?? 0) === 0;
}

/**
 * Категории и скрытые примеры товаров ниши магазина. Повторно не
 * срабатывает: магазин уже не пуст. Возвращает, сколько товаров создано.
 */
export async function applyNicheTemplate(ctx: TenantContext): Promise<{ products: number }> {
  if (!(await templateAvailable(ctx)) || (await getSetting(ctx, APPLIED_KEY)))
    throw new UserError(
      "err.template.notEmpty",
      "Примеры добавляются только в пустой магазин — у вас уже есть товары или категории.",
    );
  const tpl = NICHE_TEMPLATES[ctx.tenant.vertical];
  const lang = templateLang(ctx.tenant.settings.default_locale);
  const currency = ((await getSetting(ctx, "shop_currency")) || "KZT").toUpperCase();
  await setSetting(ctx, APPLIED_KEY, new Date().toISOString());

  const categoryIds: string[] = [];
  for (const [i, c] of tpl.categories.entries())
    categoryIds.push(await createCategory(ctx, { name: c[lang], parentId: null, sortOrder: i }));
  for (const [i, p] of tpl.products.entries())
    await createProduct(ctx, {
      name: `${EXAMPLE_PREFIX[lang]}${p.name[lang]}`,
      description: p.description[lang],
      keywords: "",
      price: p.price,
      currency,
      countryPrices: {},
      categoryIds: categoryIds[p.category] ? [categoryIds[p.category]!] : [],
      isActive: false,
      sortOrder: i,
      fulfillmentKind: p.kind,
      stockQuantity: null,
      leadTimeDays: p.leadTimeDays ?? null,
    });
  return { products: tpl.products.length };
}
