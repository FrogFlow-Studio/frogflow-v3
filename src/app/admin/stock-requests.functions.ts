import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Заявки поставщикам (модуль warehouse): что заказать, правка, «заказано»,
 * текст и CSV, приход по заявке. Смотрит вся команда, кроме бухгалтера;
 * менять — менеджер и выше. Поставщику заявку отправляет сам продавец.
 */
const guards = () => import("@/app/auth/guards.server");
const viewer = async () => (await guards()).requireAdminModule("warehouse");
const manager = async () => (await guards()).requireAdminModule("warehouse", "manager");

const uuid = z.string().uuid();
const input = z.object({
  supplierId: uuid.nullable(),
  lines: z
    .array(z.object({ productId: uuid, qty: z.number().int().min(1).max(1_000_000) }))
    .min(1)
    .max(200),
});

export const requestsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await viewer();
  const { suggestRequests, listRequests } = await import("@/core/stock/requests");
  const { loadSuppliers } = await import("@/core/stock/suppliers");
  const [suggestions, requests, suppliers] = await Promise.all([
    suggestRequests(ctx),
    listRequests(ctx),
    loadSuppliers(ctx),
  ]);
  return {
    suppliers: suppliers.items.map((s) => ({ id: s.id, name: s.name })),
    suggestions,
    requests,
  };
});

export const createRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const ctx = await manager();
    const { createRequest } = await import("@/core/stock/requests");
    return createRequest(ctx, data, await (await guards()).adminActor());
  });

export const updateRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => input.extend({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await manager();
    const { updateRequest } = await import("@/core/stock/requests");
    return updateRequest(ctx, data.id, data);
  });

export const deleteRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await manager();
    const { deleteRequest } = await import("@/core/stock/requests");
    await deleteRequest(ctx, data.id);
    return { ok: true };
  });

export const orderRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await manager();
    const { markOrdered } = await import("@/core/stock/requests");
    return markOrdered(ctx, data.id);
  });

/** Черновик прихода по заказанной заявке (проводится на странице прихода). */
export const receiveRequestFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await manager();
    const { receiptFromRequest } = await import("@/core/stock/request-receive");
    const r = await receiptFromRequest(ctx, data.id, await (await guards()).adminActor());
    return { receiptId: r.id, no: r.no };
  });

/** Текст заявки для мессенджера и CSV для Excel — на языке продавца. */
export const requestExportFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await viewer();
    const { loadRequest, requestText, requestCsv } = await import("@/core/stock/requests");
    const { loadSuppliers } = await import("@/core/stock/suppliers");
    const { sellerLocale } = await import("@/core/catalog/low-stock");
    const { UserError } = await import("@/core/i18n/user-error");
    const req = await loadRequest(ctx, data.id);
    if (!req) throw new UserError("err.stock.requestNotFound", "Заявка не найдена.");
    const locale = await sellerLocale(ctx);
    const supplier = req.supplierId
      ? ((await loadSuppliers(ctx)).items.find((s) => s.id === req.supplierId) ?? null)
      : null;
    return { text: requestText(req, supplier, locale), csv: requestCsv(req, locale), no: req.no };
  });
