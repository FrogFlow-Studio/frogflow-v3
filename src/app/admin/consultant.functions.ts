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
  const { listStoryTags } = await import("@/core/consultant/story-tags");
  const [tags, products] = await Promise.all([
    listStoryTags(ctx),
    ctx.db
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .limit(500)
      .then((r) => r.data ?? []),
  ]);
  return { tags, products };
});

export const upsertStoryTagFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        story: z.string().min(1).max(300),
        productId: z.string().uuid().nullable().optional(),
        productName: z.string().min(1).max(200),
        price: z.number().nonnegative().nullable().optional(),
        notes: z.string().max(500).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { upsertStoryTag } = await import("@/core/consultant/story-tags");
    return upsertStoryTag(ctx, {
      story: data.story,
      product_id: data.productId ?? null,
      product_name: data.productName,
      price: data.price ?? null,
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
