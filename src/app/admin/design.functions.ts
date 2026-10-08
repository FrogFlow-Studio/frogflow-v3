import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PHOTO_SHAPES, STORE_BLOCKS, STORE_THEMES } from "@/core/storefront/design";

/** Оформление витрины (core/storefront/design): читают все сотрудники, меняет владелец. */
export const storeDesignFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("@/core/storefront/design.server")).designView(ctx);
});

export const saveStoreDesignFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        theme: z.enum(STORE_THEMES),
        cover: z.boolean(),
        blocks: z.array(z.enum(STORE_BLOCKS)).max(STORE_BLOCKS.length),
        photo: z.enum(PHOTO_SHAPES),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("admin");
    return (await import("@/core/storefront/design.server")).saveDesign(ctx, data);
  });
