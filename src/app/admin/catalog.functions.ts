import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import { CATALOG_LAYOUTS, CATALOG_ORDER_MAX } from "@/core/storefront/categories";

/**
 * Админка продавца: импорт каталога, Google-таблица, категории и раскладка витрины.
 * Каждая серверная функция начинается с гварда (requireAdmin…): контекст
 * арендатора берётся из сессии, подключение к базе — под его ролью.
 */

const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

/** Изменения — менеджеру и владельцу; настройки, оплата, модули, команда — только владельцу (core/auth/roles). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

const uuid = z.string().uuid();

/* ── каталог ─────────────────────────────────────────────────────── */

/** Импорт каталога из CSV или Excel (.xlsx, base64): предпросмотр (что создастся и обновится) или применение. */
export const importCatalogFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(4_000_000).optional(),
        xlsx: z.string().min(1).max(8_000_000).optional(),
        apply: z.boolean().default(false),
      })
      .refine((v) => Boolean(v.csv) !== Boolean(v.xlsx))
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const m = await import("@/core/catalog/import.server");
    const csv = data.xlsx
      ? (await import("@/core/catalog/xlsx.server")).xlsxToCsv(Buffer.from(data.xlsx, "base64"))
      : data.csv!;
    if (!data.apply) return { preview: await m.previewImport(ctx, csv), result: null };
    return { preview: null, result: await m.applyImport(ctx, csv, await actor()) };
  });

/** Каталог из Google Таблицы: ссылка, настройки и итог последнего обновления. */
export const catalogSheetFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await import("@/core/catalog/sheet.server")).loadSheet(ctx);
});

/** Предпросмотр таблицы по ссылке: ничего не пишет. */
export const previewCatalogSheetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await import("@/core/catalog/sheet.server")).previewSheet(ctx, data.url);
  });

/** Подключить таблицу (или сменить настройки) и сразу загрузить её — после предпросмотра. */
export const saveCatalogSheetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        url: z.string().min(1).max(500),
        hideMissing: z.boolean(),
        overwriteManual: z.boolean(),
        run: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { sheetCsvUrl, SHEET_CONFIG_KEY } = await import("@/core/catalog/sheet");
    if (!sheetCsvUrl(data.url))
      throw new UserError(
        "err.catalog.sheetBadLink",
        "Нужна ссылка на Google Таблицу (docs.google.com/spreadsheets/…)",
      );
    const { setSetting } = await import("@/core/settings/settings");
    await setSetting(
      ctx,
      SHEET_CONFIG_KEY,
      JSON.stringify({
        url: data.url.trim(),
        hideMissing: data.hideMissing,
        overwriteManual: data.overwriteManual,
      }),
    );
    if (!data.run) return null;
    return (await (await import("@/core/catalog/sheet.server")).runSheetSync(ctx, "interactive"))
      ?.run;
  });

/** Обновить каталог из таблицы сейчас, не дожидаясь ночи. */
export const syncCatalogSheetFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  return (await (await import("@/core/catalog/sheet.server")).runSheetSync(ctx, "interactive"))
    ?.run;
});

/** Отключить таблицу: товары остаются как есть, ночные обновления прекращаются. */
export const disconnectCatalogSheetFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  const { SHEET_CONFIG_KEY, SHEET_STATUS_KEY } = await import("@/core/catalog/sheet");
  const { error } = await ctx.db
    .from("app_settings")
    .delete()
    .in("key", [SHEET_CONFIG_KEY, SHEET_STATUS_KEY]);
  if (error) throw serverFailure(`Таблица каталога: не отключилась: ${error.message}`);
  return { ok: true };
});

export const categoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await import("@/core/catalog/admin")).listAllCategories(ctx);
});

export const saveCategoryFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid.nullable(),
        name: z.string().min(1).max(120),
        parentId: uuid.nullable(),
        sortOrder: z.number().int().default(0),
        isVisible: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const m = await import("@/core/catalog/admin");
    const { id, ...input } = data;
    if (id) {
      await m.updateCategory(ctx, id, input);
      return { id };
    }
    return { id: await m.createCategory(ctx, input) };
  });

/** Раскладка верхнего ряда категорий витрины (app_settings mini_app_catalog, формат v1). */
export const catalogLayoutFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { getSetting } = await import("@/core/settings/settings");
  const { parseCatalogLayout } = await import("@/core/storefront/categories");
  return parseCatalogLayout(await getSetting(ctx, "mini_app_catalog"));
});

export const saveCatalogLayoutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        layout: z.enum(CATALOG_LAYOUTS),
        order: z.array(uuid).max(CATALOG_ORDER_MAX),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { setSetting } = await import("@/core/settings/settings");
    const order = [...new Set(data.order)];
    await setSetting(ctx, "mini_app_catalog", JSON.stringify({ layout: data.layout, order }));
    return { ok: true };
  });

/** Порядок перетаскиванием: товары страницы или соседние категории (core/catalog/reorder). */
export const reorderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        table: z.enum(["products", "categories"]),
        ids: z.array(z.string().uuid()).min(1).max(200),
        start: z.number().int().min(0).max(1e7).default(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { applyOrder } = await import("@/core/catalog/reorder");
    await applyOrder(ctx, data.table, data.ids, data.start);
    return { ok: true };
  });

export const deleteCategoryFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    await (await import("@/core/catalog/admin")).deleteCategory(ctx, data.id);
    return { ok: true };
  });
