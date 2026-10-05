import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Изменения — менеджеру и владельцу (как остальные кнопки «Обзора»). */
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");

/**
 * «Пробный заказ» (Р4): проверка оформления без заказа в базе — цена, оплата,
 * файл, выдача, получатели уведомлений — и пробное уведомление продавцу.
 */
export const trialOrderFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ productId: z.string().uuid().nullable().default(null) }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    const { runTrialOrder } = await import("./onboarding.server");
    return runTrialOrder(ctx, data.productId);
  });
