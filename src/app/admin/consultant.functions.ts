import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Теги товаров на сторис для консультанта (core/consultant/story-tags):
 * список — любому сотруднику, правка — менеджеру и владельцу.
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

export const storyTagsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await admin();
  const { listStoryTags, storyProductsOf } = await import("@/core/consultant/story-tags");
  const { pricelistMode } = await import("@/core/consultant/pricelist/mode");
  const tags = (await listStoryTags(ctx)).map((t) => ({ ...t, items: storyProductsOf(t) }));
  return {
    tags,
    source: pricelistMode(ctx.tenant) ? ("pricelist" as const) : ("catalog" as const),
  };
});

/**
 * Товары для привязки к публикации: у консультанта «по прайсу» — из прайса 1С
 * (его знает консультант), у остальных — из каталога (core/consultant/story-picker).
 */
export const storyProductsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().max(100).default("") }).parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { searchStoryProducts } = await import("@/core/consultant/story-picker");
    return searchStoryProducts(ctx, data.q);
  });

export const upsertStoryTagFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        story: z.string().min(1).max(300),
        // id прайса 1С — артикул, не uuid: проверяется только длина.
        products: z
          .array(
            z.object({
              id: z.string().trim().min(1).max(100).nullable(),
              name: z.string().trim().min(1).max(200),
              price: z.number().nonnegative().nullable(),
            }),
          )
          .min(1)
          .max(10),
        notes: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { upsertStoryTag } = await import("@/core/consultant/story-tags");
    return upsertStoryTag(ctx, {
      story: data.story,
      products: data.products,
      notes: data.notes ?? null,
    });
  });

export const deleteStoryTagFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { deleteStoryTag } = await import("@/core/consultant/story-tags");
    await deleteStoryTag(ctx, data.id);
    return { ok: true };
  });
