import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * «Прайс консультанта» (app/admin/pricelist.server): смотреть — любому
 * сотруднику, менять — менеджеру и владельцу.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");
const server = () => import("./pricelist.server");
/** Задачи консультанта — с именами и телефонами покупателей: не ниже менеджера. */
const contacts = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole(
    (await import("@/core/auth/roles")).CONTACTS_MIN_ROLE,
  );

export const pricelistFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await server()).pricelistOverview(ctx);
});

/** Выгрузка 1С: CSV текстом или Excel (.xlsx) в base64; `confirm` — продавец видел скачок цен. */
export const importPricelistFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        csv: z.string().min(1).max(4_000_000).optional(),
        xlsx: z.string().min(1).max(8_000_000).optional(),
        fileName: z.string().max(200),
        confirm: z.boolean().optional(),
      })
      .refine((v) => Boolean(v.csv) !== Boolean(v.xlsx))
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const m = await server();
    const csv = data.xlsx ? m.pricelistCsvFromXlsx(Buffer.from(data.xlsx, "base64")) : data.csv!;
    return m.importPricelist(ctx, csv, data.fileName, { confirm: data.confirm });
  });

/** Разовая загрузка прайса по ссылке Google Drive на файл. */
export const importPricelistDriveFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ url: z.string().trim().min(8).max(500), confirm: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).importPricelistDrive(ctx, data.url, { confirm: data.confirm });
  });

export const savePricelistSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        synonyms: z.string().max(20_000),
        shopUrl: z.string().max(300),
        store: z.object({
          address: z.string().max(300),
          phone: z.string().max(100),
          hours: z.string().max(200),
        }),
        followUp: z.boolean().optional(),
        qualityDigest: z.boolean().optional(),
        taskReminders: z.boolean().optional(),
        hours: z
          .object({ open: z.number().int().min(0).max(24), close: z.number().int().min(0).max(24) })
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).savePricelistSettings(ctx, data);
  });

export const setPricelistRateFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ rate: z.number() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).setManualRate(ctx, data.rate);
  });

export const refreshPricelistRateFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  return (await server()).refreshPricelistRate(ctx);
});

export const addProductMediaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        key: z.string().min(1).max(200),
        match: z.string().max(200),
        color: z.string().max(60).optional(),
        name: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).addProductMedia(ctx, data);
  });

export const deleteProductMediaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).deleteProductMedia(ctx, data.id);
  });

export const savePricelistArticlesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        articles: z
          .array(
            z.object({
              id: z.string().max(100).optional(),
              title: z.string().max(300),
              tags: z.array(z.string().max(60)).max(30).optional(),
              content: z.string().max(40_000),
            }),
          )
          .max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).savePricelistArticles(ctx, data.articles);
  });

export const savePricelistArticleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().max(100).optional(),
        title: z.string().max(300),
        tags: z.array(z.string().max(60)).max(30).optional(),
        content: z.string().max(40_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).savePricelistArticle(ctx, data);
  });

export const deletePricelistArticleFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).deletePricelistArticle(ctx, data.id);
  });

const importedArticle = z.object({
  title: z.string().max(300),
  tags: z.array(z.string().max(60)).max(30),
  content: z.string().max(40_000),
});

/**
 * Предпросмотр загрузки в базу знаний: PDF, Word (.docx), .txt/.md (base64)
 * или вставленный текст. Ничего не пишет — только статьи для показа.
 */
export const previewKnowledgeImportFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .union([
        z.object({ text: z.string().min(1).max(400_000) }),
        // Потолок на строку base64 с запасом; настоящий предел — по байтам на сервере.
        z.object({
          fileName: z.string().min(1).max(200),
          base64: z.string().min(1).max(6_000_000),
        }),
      ])
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).previewKnowledgeImport(ctx, data);
  });

/** Добавить статьи из предпросмотра к базе знаний (прежние остаются). */
export const addKnowledgeArticlesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ articles: z.array(importedArticle).min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).addKnowledgeArticles(ctx, data.articles);
  });

/** Предпросмотр прайса из Google Таблицы: разница с текущим. Ничего не пишет. */
export const previewPricelistSheetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ url: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).previewPricelistSheetFor(ctx, data.url);
  });

/** Загрузить прайс из таблицы (после предпросмотра) и обновлять его автоматически. */
export const importPricelistSheetFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ url: z.string().min(1).max(500), fingerprint: z.string().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).importPricelistSheetFor(ctx, data.url, data.fingerprint);
  });

/** Отключить таблицу: прайс остаётся, автообновление прекращается. */
export const disconnectPricelistSheetFn = createServerFn({ method: "POST" }).handler(async () => {
  const ctx = await adminWrite();
  return (await server()).disconnectPricelistSheetFor(ctx);
});

export const savePricelistPersonaFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        persona: z
          .object({
            brand: z.string().max(200),
            about: z.string().max(2000),
            tone: z.string().max(2000),
            specialities: z.string().max(10_000),
          })
          .nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).savePricelistPersona(ctx, data.persona);
  });

export const consultantTasksFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await contacts();
  return (await server()).consultantTasks(ctx);
});

export const markConsultantTaskFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ id: z.string().min(1).max(100), done: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await contacts();
    return (await server()).markConsultantTask(ctx, data.id, data.done);
  });

export const clearConsultantTasksFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ which: z.enum(["done", "all"]) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await contacts();
    return (await server()).clearConsultantTasks(ctx, data.which);
  });
