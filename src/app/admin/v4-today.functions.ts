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

export const v4AdvanceFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const by = await guards.adminActor();
    const { advanceV4Order } = await import("./v4-today.server");
    return advanceV4Order(ctx, { orderId: data.orderId, by });
  });

const productKind = z.enum(["file", "club"]);
const payKind = z.enum([
  "transfer",
  "prodamus",
  "apipay",
  "robokassa",
  "stripe",
  "kaspi",
  "nowpayments",
]);

export const v4SaveProductFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(200),
        kind: productKind,
        priceMinor: z.number().int().min(0).max(1_000_000_000),
        description: z.string().trim().max(4000).optional(),
        productId: z.string().uuid().optional(),
        trackStock: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const { saveV4Product } = await import("./v4-today.server");
    return saveV4Product(ctx, data);
  });

export const v4StocktakeFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        productId: z.string().uuid(),
        target: z.number().int().min(0).max(1_000_000),
        externalRef: z.string().trim().min(1).max(80),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const by = await guards.adminActor();
    const { stocktakeV4 } = await import("./v4-today.server");
    return stocktakeV4(ctx, { ...data, by });
  });

export const v4AddLessonFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ productId: z.string().uuid(), title: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const { addV4Lesson } = await import("./v4-today.server");
    return addV4Lesson(ctx, data);
  });

export const v4SaveMethodFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        kind: payKind,
        country: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/)
          .nullable(),
        currency: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{3}$/),
        details: z.string().trim().max(2000),
        methodId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const { saveV4Method } = await import("./v4-today.server");
    return saveV4Method(ctx, data);
  });

export const v4ReplyFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ caseId: z.string().uuid(), text: z.string().trim().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data }) => {
    const guards = await import("@/app/auth/guards.server");
    const ctx = await guards.requireAdminRole("manager");
    const by = await guards.adminActor();
    const { replyV4Case } = await import("./v4-today.server");
    return replyV4Case(ctx, { ...data, by });
  });
