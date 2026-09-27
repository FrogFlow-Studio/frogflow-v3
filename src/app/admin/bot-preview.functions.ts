import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

/**
 * Предпросмотр бота: только чтение, в Telegram ничего не уходит. Открыт
 * всем ролям через requireAdmin(), кроме бухгалтера (ему закрыто всё, что
 * явно не открыто).
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();

export const botPreviewFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({
        locale: z.enum(SUPPORTED_LOCALES).optional(),
        productId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { botPreview } = await import("./bot-preview.server");
    return botPreview(ctx, data);
  });

export const botPreviewProductsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ q: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { botPreviewProducts } = await import("./bot-preview.server");
    return botPreviewProducts(ctx, data.q);
  });
