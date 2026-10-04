import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Раздел «Склад» (модуль warehouse): поставщики и их привязка к товарам.
 * Смотрит вся команда, кроме бухгалтера; менять — менеджер и выше.
 */
const guards = () => import("@/app/auth/guards.server");

const uuid = z.string().uuid();
const supplierInput = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  note: z.string().trim().max(1000).default(""),
});

export const suppliersFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await guards()).requireAdminModule("warehouse");
  const { loadSuppliers, productSuppliers } = await import("@/core/stock/suppliers");
  const list = await loadSuppliers(ctx);
  const links = await productSuppliers(ctx);
  const counts: Record<string, number> = {};
  for (const sid of links.values()) counts[sid] = (counts[sid] ?? 0) + 1;
  return { rev: list.rev, items: list.items, products: counts };
});

export const addSupplierFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ rev: z.number().int().min(0), supplier: supplierInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { addSupplier } = await import("@/core/stock/suppliers");
    return addSupplier(ctx, data.rev, data.supplier);
  });

export const updateSupplierFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ rev: z.number().int().min(0), id: uuid, supplier: supplierInput }).parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { updateSupplier } = await import("@/core/stock/suppliers");
    return updateSupplier(ctx, data.rev, data.id, data.supplier);
  });

export const removeSupplierFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ rev: z.number().int().min(0), id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { removeSupplier } = await import("@/core/stock/suppliers");
    return removeSupplier(ctx, data.rev, data.id);
  });

/** Карточка товара: все поставщики и основной поставщик этого товара. */
export const productSupplierFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse");
    const { loadSuppliers, productSuppliers } = await import("@/core/stock/suppliers");
    const list = await loadSuppliers(ctx);
    const known = new Set(list.items.map((s) => s.id));
    const links = await productSuppliers(ctx);
    const current = links.get(data.id) ?? null;
    return {
      suppliers: list.items.map((s) => ({ id: s.id, name: s.name })),
      current: current && known.has(current) ? current : null,
    };
  });

export const setProductSupplierFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid, supplierId: uuid.nullable() }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { setProductSupplier } = await import("@/core/stock/suppliers");
    await setProductSupplier(ctx, data.id, data.supplierId);
    return { supplierId: data.supplierId };
  });
