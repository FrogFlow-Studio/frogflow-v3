import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * «Сегодня (v4)» в панели продавца: дела магазина в схеме v4 и кнопки по ним.
 * Ничего не переключает: магазин, которого нет в v4, видит пояснение, а не
 * данные. Смотреть может вся команда, нажимать кнопки — менеджер и выше.
 */
const lang = z.enum(["ru", "kk", "en", "uz"]);

export const v4TodayFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ lang }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await import("@/app/auth/guards.server")).requireAdmin();
    const { loadV4Today } = await import("./v4-today.server");
    return loadV4Today(ctx, data.lang);
  });

export const v4CaseActionFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        caseId: z.string().uuid(),
        action: z.enum(["receipt_accept", "receipt_reject", "return_to_bot", "close_case"]),
        reason: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const by = await guards.adminActor();
    const { runV4CaseAction } = await import("./v4-today.server");
    return runV4CaseAction(ctx, { ...data, by });
  });
