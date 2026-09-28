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

export const pricelistFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  return (await server()).pricelistOverview(ctx);
});

export const importPricelistFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ csv: z.string().min(1).max(4_000_000), fileName: z.string().max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await server()).importPricelist(ctx, data.csv, data.fileName);
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
