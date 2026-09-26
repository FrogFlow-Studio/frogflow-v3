import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * ИИ-помощник продавца (core/assistant): черновик описания в форме товара и
 * черновик поста о товаре в «Публикациях». Ничего не сохраняет — текст
 * попадает в поле, продавец правит и сохраняет сам. Пишет менеджер и выше.
 */
const lang = z.enum(["ru", "kk", "en", "uz"]).optional();

export const assistDescriptionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().max(200),
        description: z.string().max(4000).default(""),
        keywords: z.string().max(500).default(""),
        price: z.number().nonnegative().max(1e9).nullable().optional(),
        currency: z.string().max(8).nullable().optional(),
        kind: z.enum(["digital", "physical"]).nullable().optional(),
        lang,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("manager");
    const { assistText } = await import("@/core/assistant/assistant.server");
    const text = await assistText(ctx, {
      task: "description",
      lang: data.lang ?? ctx.tenant.settings.default_locale ?? "ru",
      product: data,
    });
    return { text };
  });

export const assistPostFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ productId: z.string().uuid(), lang }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (
      await import("@/app/auth/guards.server")
    ).requireAdminModule("instagram", "manager");
    const { assistText } = await import("@/core/assistant/assistant.server");
    const { productForPost } = await import("@/core/assistant/product-input.server");
    const p = await productForPost(ctx, data.productId);
    const text = await assistText(ctx, {
      task: "post",
      lang: data.lang ?? ctx.tenant.settings.default_locale ?? "ru",
      product: p.product,
    });
    return { text, image: p.image };
  });
