import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Отчёты склада (модуль warehouse): залежавшийся товар. Смотрит вся команда,
 * кроме бухгалтера (как и остальной раздел «Склад»).
 */
const guards = () => import("@/app/auth/guards.server");

export const staleFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z.object({ days: z.number().int().min(7).max(365).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse");
    const { staleReport } = await import("@/core/stock/stale");
    return staleReport(ctx, data.days);
  });

/** «Создать акцию» из отчёта: названия выбранных товаров для очереди в форме акций. */
export const offerQueueFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(20) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("limited_offers", "manager");
    const { productsByIds } = await import("@/core/catalog/picker");
    const found = await productsByIds(ctx, data.ids);
    // Порядок — как выбрал продавец.
    const byId = new Map(found.map((p) => [p.id, p]));
    return data.ids.flatMap((id) => byId.get(id) ?? []);
  });
