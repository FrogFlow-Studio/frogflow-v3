import { createCategory, createProduct } from "@/core/catalog/admin";
import { UserError } from "@/core/i18n/user-error";
import { getSetting, setSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { saveCourse } from "@/core/courses/course.server";
import { COURSE_EXAMPLE, EXAMPLE_PREFIX, NICHE_TEMPLATES, templateLang } from "./niches";

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
 * Категории и скрытые примеры товаров ниши магазина; с включёнными
 * «Курсами» — ещё скрытый пример курса с уроками. Повторно не срабатывает:
 * магазин уже не пуст. Возвращает, сколько товаров создано.
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
  if (!ctx.tenant.modules.courses) return { products: tpl.products.length };
  const c = COURSE_EXAMPLE;
  const courseId = await createProduct(ctx, {
    name: `${EXAMPLE_PREFIX[lang]}${c.name[lang]}`,
    description: c.description[lang],
    keywords: "",
    price: c.price,
    currency,
    countryPrices: {},
    categoryIds: categoryIds[0] ? [categoryIds[0]] : [],
    isActive: false,
    sortOrder: tpl.products.length,
    fulfillmentKind: "digital",
    stockQuantity: null,
    leadTimeDays: null,
  });
  await saveCourse(ctx, courseId, {
    schedule: { mode: "drip", everyDays: c.everyDays },
    lessons: c.lessons.map((l) => ({
      id: crypto.randomUUID(),
      title: l.title[lang],
      text: l.text[lang],
      files: [],
      link: null,
      ...(l.homework ? { homework: l.homework[lang] } : {}),
    })),
  });
  return { products: tpl.products.length + 1 };
}
