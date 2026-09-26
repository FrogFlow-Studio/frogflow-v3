import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Автоворонка (модуль funnel): шаги серии для новых покупателей. */
const moduleAdmin = async (min?: "manager") =>
  (await import("@/app/auth/guards.server")).requireAdminModule("funnel", min);

export const funnelFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await moduleAdmin();
  const { loadFunnel } = await import("@/core/funnel/funnel");
  return loadFunnel(ctx);
});

export const saveFunnelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        stopOnOrder: z.boolean(),
        steps: z
          .array(
            z.object({
              afterHours: z
                .number()
                .int()
                .min(1)
                .max(45 * 24),
              text: z.string().min(1).max(2000),
              catalogButton: z.boolean(),
            }),
          )
          .max(10),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await moduleAdmin("manager");
    const { parseFunnel, saveFunnel } = await import("@/core/funnel/funnel");
    await saveFunnel(ctx, parseFunnel(JSON.stringify(data)));
    return { ok: true };
  });
