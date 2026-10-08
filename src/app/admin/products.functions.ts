import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";

/**
 * Админка продавца: товары: список, карточка, остатки, массовые действия.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

const uuid = z.string().uuid();

/** Порядок и фильтр «Язык материалов» списка товаров (core/catalog/admin). */
const productSort = z.enum(["catalog", "new", "old", "name", "price"]).optional();

const productLang = z
  .object({ lang: z.enum(["ru", "kk", "en", "uz"]), has: z.boolean() })
  .nullable()
  .optional();

export const productsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().optional(),
        categoryId: uuid.nullable().optional(),
        onlyInactive: z.boolean().optional(),
        sort: productSort,
        lang: productLang,
        noTopic: z.boolean().optional(),
        offset: z.number().int().min(0).max(1_000_000).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const m = await import("@/core/catalog/admin");
    const [page, categories] = await Promise.all([
      m.listProductsForAdmin(ctx, data),
      m.listAllCategories(ctx),
    ]);
    // «Хватит на N дней» (модуль «Склад»): только у товаров с остатком; нет продаж — null («—»).
    const { forecastFor } = await import("@/core/stock/forecast");
    const days = await forecastFor(
      ctx,
      page.rows
        .filter((p) => p.stock_quantity !== null)
        .map((p) => ({ id: p.id, name: p.name, stock: p.stock_quantity })),
    );
    const products = page.rows.map((p) => ({ ...p, days_left: days[p.id] ?? null }));
    // Шаблон магазина по типу предлагаем, пока нет ни товаров, ни категорий (и фильтров).
    const kindTemplate =
      page.total === 0 &&
      categories.length === 0 &&
      !data.q &&
      !data.categoryId &&
      !data.onlyInactive &&
      !data.lang &&
      !data.noTopic;
    // Темы магазина — подсказки для массового назначения темы (core/catalog/topics).
    const { listShopTopics } = await import("@/core/catalog/topics.server");
    const topics = data.offset ? [] : await listShopTopics(ctx);
    return {
      products,
      total: page.total,
      hasMore: page.hasMore,
      categories,
      kindTemplate,
      topics,
    };
  });

/**
 * Выбор товара в формах админки: поиск по названию (core/catalog/picker).
 * Названия товаров видит любой сотрудник — как и сам список товаров.
 */
export const productPickerFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().max(100).default(""),
        exclude: z.array(uuid).max(50).default([]),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { searchProducts } = await import("@/core/catalog/picker");
    return searchProducts(ctx, { q: data.q, exclude: data.exclude });
  });

export const productFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid.nullable() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const m = await import("@/core/catalog/admin");
    const { listPaymentMethods } = await import("@/core/settings/payment-methods");
    const [product, categories, methods] = await Promise.all([
      data.id ? m.getProductForAdmin(ctx, data.id) : null,
      m.listAllCategories(ctx),
      listPaymentMethods(ctx),
    ]);
    // null — не удалось прочитать: «0 ждут» там было бы неправдой.
    const waitlistModule = await import("@/core/waitlist/waitlist");
    const waiting =
      data.id && ctx.tenant.modules.waitlist
        ? await waitlistModule.countWaiting(ctx, data.id).catch(() => null)
        : 0;
    const waitlistRun =
      data.id && ctx.tenant.modules.waitlist
        ? await waitlistModule.lastWaitlistRun(ctx, data.id).catch(() => null)
        : null;
    const low = ctx.tenant.modules.stock
      ? await (await import("@/core/catalog/low-stock")).loadThresholds(ctx, data.id)
      : { shop: 0, own: null };
    const preorder =
      data.id && ctx.tenant.modules.stock
        ? await (await import("@/core/preorder/preorder")).getPreorderRaw(ctx, data.id)
        : null;
    const preorderPast = preorder
      ? (await import("@/core/preorder/preorder")).preorderDatePast(preorder, ctx.timezone)
      : false;
    const { listShopTopics } = await import("@/core/catalog/topics.server");
    return {
      preorderPast,
      product,
      /** Подсказки для поля «Тема»: темы, уже заведённые в магазине. */
      topics: await listShopTopics(ctx),
      waiting,
      waitlistRun,
      lowStock: low,
      preorder,
      categories,
      countries: methods
        .filter((x) => x.is_active)
        .map((x) => ({ code: x.country_code, name: x.country_name, currency: x.currency })),
      defaultFulfillment: (await import("@/core/verticals/registry")).VERTICALS[ctx.tenant.vertical]
        .defaultFulfillment,
    };
  });

/** История остатка товара за 30 дней, страницами (блок в карточке товара). */
export const stockHistoryFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ productId: uuid, page: z.number().int().min(0).max(1000).default(0) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { listStockHistory } = await import("@/core/catalog/stock-history");
    return listStockHistory(ctx, data.productId, { page: data.page });
  });

const productInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  keywords: z.string().max(1000).default(""),
  /** Темы для «Похожих» (core/catalog/topics); не передали — ключевые слова пишутся как есть. */
  topics: z.array(z.string().max(200)).max(20).optional(),
  price: z.number().min(0),
  currency: z.string().length(3),
  countryPrices: z.record(z.string(), z.number().positive()).default({}),
  categoryIds: z.array(uuid).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  fulfillmentKind: z.enum(["digital", "physical"]),
  stockQuantity: z.number().int().min(0).nullable().default(null),
  leadTimeDays: z.number().int().min(0).nullable().default(null),
  images: z.array(z.string().min(1)).max(20).default([]),
  materials: z
    .array(
      z.object({
        language: z.enum(["ru", "kk", "en", "uz"]),
        filePath: z.string().min(1),
        fileName: z.string().nullable(),
      }),
    )
    .max(50)
    .default([]),
  variants: z
    .array(z.object({ name: z.string().min(1).max(80), price: z.number().min(0) }))
    .max(30)
    .default([]),
  /** Предупредить продавцу, когда остаток ≤ этого числа; null — порог магазина (core/catalog/low-stock). */
  lowStockAt: z.number().int().min(0).max(100_000).nullable().default(null),
  /** Предзаказ при нехватке остатка (core/preorder): только физический товар и модуль «Склад». */
  preorderOn: z.boolean().default(false),
  preorderFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  /** Курс (модуль «Курсы»): уроки вместо файлов — файл не обязателен (core/courses/marker). */
  isCourse: z.boolean().default(false),
});

/** Пример цифрового товара: до 5 картинок (core/catalog/preview). */
export const productPreviewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { loadPreview } = await import("@/core/catalog/preview");
    return loadPreview(ctx, data.id);
  });

export const saveProductPreviewFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: uuid, keys: z.array(z.string().min(1).max(300)).max(5) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { savePreview } = await import("@/core/catalog/preview");
    return savePreview(ctx, data.id, data.keys);
  });

/** Товар-подписка: период продления в днях (модуль subscriptions); null — не подписка. */
export const productSubscriptionFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { loadSubscriptionDays } = await import("@/core/catalog/subscription");
    return { days: await loadSubscriptionDays(ctx, data.id) };
  });

export const saveProductSubscriptionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: uuid, days: z.number().int().min(7).max(365).nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { requireAdminModule } = await import("@/app/auth/guards.server");
    const ctx = await requireAdminModule("subscriptions", "manager");
    const { saveSubscriptionDays } = await import("@/core/catalog/subscription");
    return { days: await saveSubscriptionDays(ctx, data.id, data.days) };
  });

export const saveProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid.nullable(), product: productInput }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    // Один бюджет на запрос: перенос предзаказа и лист ожидания идут друг за
    // другом, вместе они не должны выйти за предел функции (120 с).
    const { requestBudget } = await import("@/core/notify/budget");
    const budget = requestBudget();
    const m = await import("@/core/catalog/admin");
    const {
      images,
      materials,
      variants,
      isCourse,
      lowStockAt,
      preorderOn,
      preorderFrom,
      topics,
      ...rest
    } = data.product;
    // Тема хранится в конце ключевых слов служебной частью «#тема: …».
    const { joinKeywords } = await import("@/core/catalog/topics");
    const fields = topics ? { ...rest, keywords: joinKeywords(rest.keywords, topics) } : rest;
    // Курс продаётся, когда у него появятся уроки: без них товар не попадёт
    // на витрину (core/courses/course.server syncCourseMarker).
    const course = isCourse && ctx.tenant.modules.courses;
    if (fields.fulfillmentKind === "digital" && materials.length === 0 && !course)
      throw new UserError(
        "err.admin.digitalNeedsFile",
        "Цифровому товару нужен хотя бы один файл — иначе покупатель заплатит и ничего не получит.",
      );
    let id = data.id;
    const before = id ? await stockState(ctx, id) : null;
    if (id) await m.updateProduct(ctx, id, fields);
    else id = await m.createProduct(ctx, fields);
    await Promise.all([
      m.setProductImages(ctx, id, images),
      m.setProductMaterials(ctx, id, materials),
      m.setProductVariants(ctx, id, variants),
    ]);
    if (ctx.tenant.modules.stock) {
      const { saveProductThreshold } = await import("@/core/catalog/low-stock");
      await saveProductThreshold(ctx, id, lowStockAt);
      const { savePreorder, getPreorderRaw } = await import("@/core/preorder/preorder");
      const preorderBefore = await getPreorderRaw(ctx, id);
      const preorderOnNow = preorderOn && fields.fulfillmentKind === "physical";
      await savePreorder(ctx, id, preorderOnNow ? { on: true, from: preorderFrom } : { on: false });
      // Срок отправки сдвинулся — покупатели с открытым заказом узнают об этом.
      const { isMove } = await import("@/core/preorder/reschedule");
      const preorderAfter = preorderOnNow ? await getPreorderRaw(ctx, id) : null;
      if (isMove(preorderBefore, preorderAfter)) {
        const { notifyPreorderMovedChannels } = await import("@/app/preorder/notify.server");
        await notifyPreorderMovedChannels(
          ctx,
          {
            productId: id,
            name: fields.name,
            from: preorderBefore!.from,
            to: preorderAfter!.from,
          },
          { budgetMs: budget.left() },
        ).catch((e) => console.error(`[admin:${ctx.tenant.id}] перенос предзаказа ${id}`, e));
      }
    }
    // История остатка: правка в карточке (у нового товара «было» — не учитывался).
    {
      const { recordStockChange } = await import("@/core/catalog/stock-history");
      await recordStockChange(
        ctx,
        { productId: id, from: before ? before.stock_quantity : null, to: fields.stockQuantity },
        { reason: "edit", actor: await actor() },
      );
    }
    const waitlist = await maybeNotifyWaitlist(ctx, id, before, budget.left());
    return { id, waitlist };
  });

async function stockState(ctx: TenantContext, id: string) {
  const { data, error: dataError } = await ctx.db
    .from("products")
    .select("is_active, stock_quantity, name")
    .eq("id", id)
    .maybeSingle();
  if (dataError) throw serverFailure(`Админка: ${dataError.message}`);
  return data;
}

/** Товар вернулся в продажу — лист ожидания получает сообщение (модуль waitlist). */
async function maybeNotifyWaitlist(
  ctx: TenantContext,
  id: string,
  before: Awaited<ReturnType<typeof stockState>> | null,
  budgetMs?: number,
) {
  if (!ctx.tenant.modules.waitlist || !before) return null;
  const after = await stockState(ctx, id);
  const { backInStock, inStock, lastWaitlistRun } = await import("@/core/waitlist/waitlist");
  if (!after) return null;
  if (!backInStock(before, after)) {
    // Прошлая рассылка не успела всех (вышел бюджет времени): товар в продаже —
    // досылаем оставшимся при следующем сохранении карточки.
    if (!inStock(after)) return null;
    const last = await lastWaitlistRun(ctx, id).catch(() => null);
    if (!last || last.left <= 0) return null;
  }
  const { notifyBackInStock } = await import("@/app/waitlist/notify.server");
  return notifyBackInStock(ctx, { id, name: after.name }, { budgetMs });
}

export const deleteProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/catalog/admin")).deleteProduct(ctx, data.id);
    return { ok: true };
  });

export const setProductActiveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid, active: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const before = await stockState(ctx, data.id);
    await (await import("@/core/catalog/admin")).setProductActive(ctx, data.id, data.active);
    const waitlist = await maybeNotifyWaitlist(ctx, data.id, before);
    return { ok: true, waitlist };
  });

/** «Выбрать все по фильтру»: id всех товаров списка под текущим фильтром (постранично, без обрезки). */
export const productIdsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        q: z.string().optional(),
        categoryId: uuid.nullable().optional(),
        onlyInactive: z.boolean().optional(),
        sort: productSort,
        lang: productLang,
        noTopic: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { listProductIdsForAdmin } = await import("@/core/catalog/admin");
    return { ids: await listProductIdsForAdmin(ctx, data) };
  });

/** Массовые действия над выбранными товарами списка (core/catalog/bulk). */
export const bulkProductsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        ids: z.array(uuid).min(1).max(500),
        action: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("active"), active: z.boolean() }),
          z.object({
            kind: z.literal("category"),
            categoryId: uuid.nullable(),
            mode: z.enum(["add", "set"]),
          }),
          z.object({ kind: z.literal("price"), percent: z.number().min(-90).max(500) }),
          z.object({
            kind: z.literal("stock"),
            mode: z.enum(["set", "add"]),
            amount: z.number().int().min(0).max(1_000_000),
          }),
          z.object({
            kind: z.literal("topic"),
            topic: z.string().max(200),
            mode: z.enum(["add", "remove"]),
          }),
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    // Рассылки по товарам списка делят один бюджет запроса, он считается с начала
    // обработчика: само массовое действие тоже занимает время.
    const { requestBudget } = await import("@/core/notify/budget");
    const budget = requestBudget();
    const { bulkUpdateProducts } = await import("@/core/catalog/bulk");
    const r = await bulkUpdateProducts(ctx, data.ids, data.action, await actor());
    // Товары, вернувшиеся в продажу, будят лист ожидания — как одиночное «показать».
    if (data.action.kind === "active" && data.action.active && ctx.tenant.modules.waitlist)
      for (const id of r.changed) {
        const was = r.before.get(id);
        if (!was) continue;
        try {
          await maybeNotifyWaitlist(
            ctx,
            id,
            {
              is_active: false,
              stock_quantity: was.stock_quantity,
              name: was.name,
            },
            budget.left(),
          );
        } catch {
          // Уведомление — на лучшее усилие: товар уже показан.
        }
      }
    // Пополнение товара без остатка тоже будит лист ожидания — как правка остатка в карточке.
    if (data.action.kind === "stock" && ctx.tenant.modules.waitlist)
      for (const x of r.stock) {
        const was = r.before.get(x.id);
        if (!was) continue;
        try {
          await maybeNotifyWaitlist(
            ctx,
            x.id,
            {
              is_active: was.is_active,
              stock_quantity: x.from,
              name: was.name,
            },
            budget.left(),
          );
        } catch {
          // Уведомление — на лучшее усилие: остаток уже записан.
        }
      }
    return { changed: r.changed.length, skipped: r.skipped, stock: r.stock };
  });

/** Копия товара (core/catalog/copy): скрытая, без продаж и отзывов; суффикс названия — на языке продавца. */
export const copyProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: uuid, suffix: z.string().max(30).default("") }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { copyProduct } = await import("@/core/catalog/copy");
    return { id: await copyProduct(ctx, data.id, data.suffix) };
  });
