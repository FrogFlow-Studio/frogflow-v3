import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "@/core/i18n/user-error";

/** Возвратные продажи (модуль winback): настройки серии. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("winback", min);

export const winbackFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { loadWinback } = await import("@/core/winback/winback");
  return loadWinback(ctx);
});

export const saveWinbackFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        days1: z.number().int().min(3).max(365),
        text1: z.string().min(1).max(1000),
        days2: z.number().int().min(4).max(365).nullable(),
        text2: z.string().max(1000),
        promo: z.string().max(40),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    if (data.days2 != null && data.days2 <= data.days1)
      throw new UserError("err.admin.winbackOrder", "Второе сообщение должно идти позже первого.");
    const { parseWinback, saveWinback } = await import("@/core/winback/winback");
    const promo = data.promo.trim().toUpperCase();
    if (promo) {
      const { findValidPromoCode } = await import("@/core/discounts/discounts");
      const r = await findValidPromoCode(ctx, promo);
      if (!r.ok)
        throw new UserError(
          "err.admin.winbackPromo",
          "Промокод {code} не найден или не действует — заведите его в «Скидках».",
          { code: promo },
        );
    }
    await saveWinback(ctx, parseWinback(JSON.stringify({ ...data, promo })));
    return { ok: true };
  });

/** «Похожие материалы» через N дней после покупки (тот же модуль winback). */
export const similarFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { loadSimilar } = await import("@/core/similar/similar");
  return loadSimilar(ctx);
});

export const saveSimilarFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        days: z.number().int().min(1).max(60),
        text: z.string().trim().min(1).max(1000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { saveSimilar } = await import("@/core/similar/similar");
    await saveSimilar(ctx, data);
    return { ok: true };
  });
