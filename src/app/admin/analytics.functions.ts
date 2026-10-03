import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * ИИ-разбор «Аналитики»: тратит ИИ-баланс клиента, поэтому — не ниже менеджера
 * (бухгалтеру закрыто). Ничего не сохраняет: текст показывается на странице.
 */
export const explainSalesFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
        lang: z.enum(["ru", "kk", "en", "uz"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdminRole("manager");
    const { explainSales } = await import("@/core/assistant/assistant.server");
    const { salesDigest } = await import("@/core/assistant/sales-digest.server");
    // Предпросмотр и пустые периоды отказывают до чтения базы и вызова модели.
    const { previewReadonly, PREVIEW_AI_OFF } = await import("@/lib/preview");
    if (previewReadonly()) {
      const { UserError } = await import("@/core/i18n/user-error");
      throw new UserError("err.assist.preview", PREVIEW_AI_OFF);
    }
    const digest = await salesDigest(ctx, data.days);
    const text = await explainSales(
      ctx,
      digest,
      data.lang ?? ctx.tenant.settings.default_locale ?? "ru",
    );
    return { text };
  });
