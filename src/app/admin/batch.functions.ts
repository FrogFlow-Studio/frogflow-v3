import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BATCH_MAX } from "@/core/orders/batch-pure";

/**
 * Сборка и печать пачкой (А16). Чтение (id по фильтру, листы, этикетки) — любому
 * сотруднику магазина, кроме бухгалтера: в этикетках телефон и адрес. Отметка
 * «собрано» меняет заказы — только тем, кто может редактировать (adminWrite).
 * Сессия продавца клиента прежней платформы здесь недействительна (guards.server).
 */
const admin = async () => (await import("@/app/auth/guards.server")).requireAdmin();
const adminWrite = async () =>
  (await import("@/app/auth/guards.server")).requireAdminRole("manager");
const actor = async () => (await import("@/app/auth/guards.server")).adminActor();

const filterSchema = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  pickup: z.enum(["today", "tomorrow", "overdue", "nodate"]).optional(),
  unpaid: z.boolean().optional(),
  assembly: z.literal("today").optional(),
});

/** Явный выбор или «все по фильтру»: ровно одно из двух. */
const selection = z
  .object({
    ids: z.array(z.number().int().positive()).max(5000).optional(),
    filter: filterSchema.optional(),
  })
  .refine((s) => Boolean(s.ids) !== Boolean(s.filter), "ids или filter");

const printable = z
  .object({
    ids: z.array(z.number().int().positive()).max(BATCH_MAX).optional(),
    filter: filterSchema.optional(),
  })
  .refine((s) => Boolean(s.ids) !== Boolean(s.filter), "ids или filter");

/** Сколько заказов по фильтру: кнопка «Выбрать все N». Постранично, без тихого предела. */
export const orderBatchCountFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => filterSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { orderIdsForFilter } = await import("@/core/orders/admin");
    return { count: (await orderIdsForFilter(ctx, data)).length };
  });

export const packingBatchFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => printable.parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { packingSlips } = await import("@/core/orders/batch");
    return { shop: ctx.tenant.name, ...(await packingSlips(ctx, data)) };
  });

export const deliveryLabelsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => printable.parse(d))
  .handler(async ({ data }) => {
    const ctx = await admin();
    const { deliveryLabels } = await import("@/core/orders/batch");
    return { shop: ctx.tenant.name, ...(await deliveryLabels(ctx, data)) };
  });

export const assembleOrdersFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => selection.parse(d))
  .handler(async ({ data }) => {
    const ctx = await adminWrite();
    return (await import("./admin.server")).assembleOrdersAndNotify(ctx, data, await actor());
  });
