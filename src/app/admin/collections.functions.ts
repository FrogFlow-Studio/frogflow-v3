import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { COLLECTION_NAME_MAX, COLLECTION_PRODUCTS_MAX } from "@/core/storefront/collections";

/** Подборки витрины (В15): список, сохранение, удаление. Витрина должна быть включена. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("web_storefront", min);

const uuid = z.string().uuid();

export const collectionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { adminCollections } = await import("./collections.server");
  return adminCollections(ctx);
});

export const saveCollectionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: z
          .string()
          .regex(/^[a-z0-9]{6,12}$/)
          .optional(),
        name: z.string().max(COLLECTION_NAME_MAX * 2),
        productIds: z.array(uuid).max(COLLECTION_PRODUCTS_MAX),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveCollection } = await import("./collections.server");
    return { id: await saveCollection(ctx, data) };
  });

export const deleteCollectionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: z.string().regex(/^[a-z0-9]{6,12}$/) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { deleteCollection } = await import("./collections.server");
    await deleteCollection(ctx, data.id);
    return { ok: true };
  });
