import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ABOUT_LIMITS } from "@/core/storefront/about";

/** Страница «О магазине» (core/storefront/about): читают все сотрудники, меняет владелец. */
export const storeAboutFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("@/core/storefront/about.server")).aboutView(ctx);
});

export const saveStoreAboutFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        description: z.string().max(ABOUT_LIMITS.description),
        phone: z.string().max(ABOUT_LIMITS.phone),
        address: z.string().max(ABOUT_LIMITS.address),
        hours: z.string().max(ABOUT_LIMITS.hours),
        delivery: z.string().max(ABOUT_LIMITS.delivery),
        payment: z.string().max(ABOUT_LIMITS.payment),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("owner");
    return (await import("@/core/storefront/about.server")).saveAbout(ctx, data);
  });
