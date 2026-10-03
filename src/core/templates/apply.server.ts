import { createCategory, createProduct, deleteCategory, deleteProduct } from "@/core/catalog/admin";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import {
  getSetting,
  getSettingStrict,
  setSetting,
  updateSettingAtomic,
} from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { saveCourse } from "@/core/courses/course.server";
import {
  COURSE_EXAMPLE,
  EXAMPLE_PREFIX,
  NICHE_TEMPLATES,
  SCHOOL_EXAMPLE,
  templateLang,
} from "./niches";

const APPLIED_KEY = "niche_template_applied";
/** id того, что создал набор: «Убрать примеры» удаляет только это. */
export const STARTER_KEY = "starter_ids";
const CHUNK = 200;

type StarterIds = { categories: string[]; products: string[] };

function parseStarter(raw: string | null): StarterIds {
  try {
    const v = JSON.parse(raw || "{}") as Partial<StarterIds>;
    const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string") : []);
    return { categories: strs(v.categories), products: strs(v.products) };
  } catch {
    return { categories: [], products: [] };
  }
}

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
  const notEmpty = () =>
    new UserError(
      "err.template.notEmpty",
      "Примеры добавляются только в пустой магазин — у вас уже есть товары или категории.",
    );
  if (!(await templateAvailable(ctx))) throw notEmpty();
  // Отметка ставится условной записью до создания: из двух одновременных вызовов
  // (повтор регистрации, двойной клик) набор кладёт только выигравший.
  const claim = await updateSettingAtomic(ctx, APPLIED_KEY, (raw) =>
    raw ? null : new Date().toISOString(),
  );
  if (claim === "skipped") throw notEmpty();
  if (claim === "failed") throw serverFailure("Примеры: не удалось поставить отметку набора");
  const ids: StarterIds = { categories: [], products: [] };
  try {
    return await createStarter(ctx, ids);
  } catch (e) {
    // Сбой на середине: убираем созданное и снимаем отметку, чтобы набор можно было повторить.
    await dropStarter(ctx, ids).catch((e2) => console.error("[starter] откат:", e2));
    await setSetting(ctx, APPLIED_KEY, "").catch(() => undefined);
    throw e;
  }
}

async function createStarter(ctx: TenantContext, ids: StarterIds): Promise<{ products: number }> {
  const tpl = NICHE_TEMPLATES[ctx.tenant.vertical];
  const lang = templateLang(ctx.tenant.settings.default_locale);
  const currency = ((await getSetting(ctx, "shop_currency")) || "KZT").toUpperCase();

  const categoryIds = ids.categories;
  for (const [i, c] of tpl.categories.entries())
    categoryIds.push(await createCategory(ctx, { name: c[lang], parentId: null, sortOrder: i }));
  const addProduct = async (input: Parameters<typeof createProduct>[1]) => {
    const id = await createProduct(ctx, input);
    ids.products.push(id);
    return id;
  };
  for (const [i, p] of tpl.products.entries())
    await addProduct({
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
  if (!ctx.tenant.modules.courses) return finishStarter(ctx, ids, tpl.products.length);
  const c = COURSE_EXAMPLE;
  const courseId = await addProduct({
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
  const lessons = c.lessons.map((l) => ({
    id: crypto.randomUUID(),
    title: l.title[lang],
    text: l.text[lang],
    files: [],
    link: null,
    ...(l.homework ? { homework: l.homework[lang] } : {}),
  }));
  if (ctx.tenant.vertical !== "courses") {
    await saveCourse(ctx, courseId, {
      schedule: { mode: "drip", everyDays: c.everyDays },
      lessons,
    });
    return finishStarter(ctx, ids, tpl.products.length + 1);
  }
  // Онлайн-школа: пример — сразу школа. Поток через две недели, урок раз в
  // неделю, два тарифа: «Самостоятельно» и «С проверкой ДЗ» с каналом.
  const s = SCHOOL_EXAMPLE;
  const base = { id: crypto.randomUUID(), name: s.selfPaced[lang], price: c.price };
  const pro = { id: crypto.randomUUID(), name: s.withReview[lang], price: c.price * 2 };
  const { error } = await ctx.db.from("product_variants").insert(
    [base, pro].map((v, i) => ({
      id: v.id,
      bot_id: ctx.tenant.id,
      product_id: courseId,
      name: v.name,
      price: v.price,
      sort_order: i,
    })),
  );
  if (error) throw serverFailure(`Тарифы примера не сохранены: ${error.message}`);
  const { todayInTz } = await import("@/core/fulfillment/pure");
  const start = new Date(`${todayInTz(ctx.timezone)}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 14);
  await saveCourse(ctx, courseId, {
    schedule: { mode: "drip", everyDays: 7 },
    lessons,
    cohorts: [
      {
        id: crypto.randomUUID(),
        title: s.cohort[lang],
        start: `${start.toISOString().slice(0, 10)}T10:00`,
        enrollUntil: null,
      },
    ],
    homeworkDays: 3,
    tariffs: {
      [base.id]: { homework: false, channel: false, accessDays: 90 },
      [pro.id]: { homework: true, channel: true, accessDays: null },
    },
  });
  return finishStarter(ctx, ids, tpl.products.length + 1);
}

async function finishStarter(
  ctx: TenantContext,
  ids: StarterIds,
  products: number,
): Promise<{ products: number }> {
  await setSetting(ctx, STARTER_KEY, JSON.stringify(ids));
  return { products };
}

/** Сколько скрытых примеров набора ещё лежит в магазине (плашка на «Обзоре»); raw — значение starter_ids. */
export async function starterLeft(ctx: TenantContext, raw: string | null): Promise<number> {
  const ids = parseStarter(raw);
  let left = 0;
  for (let i = 0; i < ids.products.length; i += CHUNK) {
    const { count, error } = await ctx.db
      .from("products")
      .select("id", { count: "exact", head: true })
      .in("id", ids.products.slice(i, i + CHUNK))
      .eq("is_active", false);
    if (error) throw serverFailure(`Примеры: ${error.message}`);
    left += count ?? 0;
  }
  return left;
}

/**
 * Удалить созданное набором. Товар, который продавец уже включил (стал
 * настоящим), и категорию, куда он положил свои товары, не трогаем. Возвращает,
 * сколько примеров удалено и сколько оставлено.
 */
async function dropStarter(
  ctx: TenantContext,
  ids: StarterIds,
): Promise<{ removed: number; kept: number; failed: StarterIds }> {
  const hidden = new Set<string>();
  for (let i = 0; i < ids.products.length; i += CHUNK) {
    const { data, error } = await ctx.db
      .from("products")
      .select("id")
      .in("id", ids.products.slice(i, i + CHUNK))
      .eq("is_active", false);
    if (error) throw serverFailure(`Примеры: ${error.message}`);
    for (const r of data ?? []) hidden.add(r.id);
  }
  let removed = 0;
  const failed: StarterIds = { categories: [], products: [] };
  for (const id of hidden) {
    try {
      await deleteProduct(ctx, id);
      removed++;
    } catch (e) {
      console.error(`[starter:${ctx.tenant.id}] товар ${id}:`, e);
      failed.products.push(id);
    }
  }
  for (const id of ids.categories) {
    try {
      await deleteCategory(ctx, id);
    } catch (e) {
      // В категории остались товары продавца или её уже нет — не наша забота;
      // сбой базы оставляет категорию в списке на повтор.
      if (!(e instanceof UserError)) failed.categories.push(id);
    }
  }
  return { removed, kept: ids.products.length - removed, failed };
}

/** «Убрать примеры»: удаляет только созданное набором и забывает его id. */
export async function removeStarter(
  ctx: TenantContext,
): Promise<{ removed: number; kept: number }> {
  const ids = parseStarter(await getSettingStrict(ctx, STARTER_KEY));
  if (!ids.products.length && !ids.categories.length) return { removed: 0, kept: 0 };
  const r = await dropStarter(ctx, ids);
  // Что не удалось из-за сбоя, остаётся в списке — повторное нажатие доделает.
  const rest = r.failed.products.length || r.failed.categories.length;
  await setSetting(ctx, STARTER_KEY, rest ? JSON.stringify(r.failed) : "");
  if (rest) throw serverFailure("Примеры: часть не удалена — повторите");
  return { removed: r.removed, kept: r.kept };
}
