import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * «ИИ-продавец (v4)»: анкета продавца и стоп-слова магазина в схеме v4.
 * Смотреть может вся команда, сохранять — администратор и выше. Магазину,
 * которого нет в v4, страница показывает пояснение.
 */
export const v4SellerSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
  return (await import("./v4-seller.server")).loadV4Seller(ctx);
});

const text = z.string().max(2000).optional();

export const saveV4SellerSettingsFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        profile: z.object({
          shop_name: text,
          about: text,
          payment_terms: text,
          delivery_terms: text,
          tone: text,
        }),
        spamWords: z.array(z.string().max(200)).max(500),
        version: z.string().regex(/^[0-9a-f]{32}$/),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("admin");
    return (await import("./v4-seller.server")).saveV4Seller(ctx, data);
  });
