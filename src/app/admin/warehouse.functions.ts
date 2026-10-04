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

// ── Приход товара (core/stock/receipts) ──

const receiptInput = z.object({
  supplierId: uuid.nullable(),
  lines: z
    .array(
      z.object({
        productId: uuid,
        variant: z.string().trim().max(200).nullable().default(null),
        qty: z.number().int().min(1).max(1_000_000),
        price: z.number().min(0).max(1_000_000_000),
      }),
    )
    .max(100),
  updateCost: z.boolean().default(false),
});

export const receiptsFn = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await (await guards()).requireAdminModule("warehouse");
  const { listReceipts } = await import("@/core/stock/receipts");
  const { loadSuppliers } = await import("@/core/stock/suppliers");
  const { inChunks } = await import("@/lib/in-chunks");
  const receipts = await listReceipts(ctx);
  const ids = receipts.flatMap((r) => r.lines.map((l) => l.productId));
  const names = new Map(
    (
      await inChunks(
        ids,
        (chunk) => ctx.db.from("products").select("id, name").in("id", chunk).order("id"),
        "Названия товаров прихода",
      )
    ).map((p) => [p.id, p.name]),
  );
  const suppliers = (await loadSuppliers(ctx)).items.map((s) => ({ id: s.id, name: s.name }));
  return {
    suppliers,
    profit: Boolean(ctx.tenant.modules.profit),
    receipts: receipts.map((r) => ({
      id: r.id,
      no: r.no,
      status: r.status,
      supplierId: r.supplierId,
      updateCost: r.updateCost,
      createdAt: r.createdAt,
      postedAt: r.postedAt,
      lines: r.lines.map((l) => ({
        productId: l.productId,
        name: names.get(l.productId) ?? "—",
        variant: l.variant,
        qty: l.qty,
        price: l.price,
        state: l.state ?? null,
        costFailed: l.costFailed === true,
      })),
    })),
  };
});

/** Товар в строке прихода: название, остаток и варианты (для их себестоимости). */
export const receiptProductFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse");
    const { serverFailure } = await import("@/lib/server-failure");
    const { pageAll } = await import("@/core/db/page");
    const { data: p, error } = await ctx.db
      .from("products")
      .select("id, name, stock_quantity")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw serverFailure(`Товар прихода: ${error.message}`);
    if (!p) return null;
    const variants = await pageAll<{ name: string }>(
      (from, to) =>
        ctx.db
          .from("product_variants")
          .select("name")
          .eq("product_id", data.id)
          .order("id")
          .range(from, to),
      "Варианты товара прихода",
    );
    return {
      id: p.id,
      name: p.name,
      stock: p.stock_quantity,
      variants: [...new Set(variants.map((v) => v.name.trim()))],
    };
  });

export const saveReceiptFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid.nullable() }).and(receiptInput).parse(d))
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminModule("warehouse", "manager");
    const { createReceipt, updateReceipt } = await import("@/core/stock/receipts");
    const { id, ...input } = data;
    const doc = id
      ? await updateReceipt(ctx, id, input)
      : await createReceipt(ctx, input, await g.adminActor());
    return { id: doc.id, no: doc.no };
  });

export const deleteReceiptFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { deleteReceipt } = await import("@/core/stock/receipts");
    await deleteReceipt(ctx, data.id);
    return { ok: true };
  });

export const postReceiptFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminModule("warehouse", "manager");
    const { postReceipt } = await import("@/core/stock/receipts");
    const doc = await postReceipt(ctx, data.id, await g.adminActor());
    return { no: doc.no, skipped: doc.lines.filter((l) => l.state === "skipped").length };
  });

// ── Списание (core/stock/writeoff) ──

export const writeoffsFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ page: z.number().int().min(0).max(10_000) }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse");
    const { listWriteoffs } = await import("@/core/stock/writeoff");
    return listWriteoffs(ctx, { page: data.page });
  });

export const writeOffFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        productId: uuid,
        qty: z.number().int().min(1).max(1_000_000),
        reason: z.enum(["defect", "loss", "own", "other"]),
        comment: z.string().trim().max(300).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminModule("warehouse", "manager");
    const { writeOff } = await import("@/core/stock/writeoff");
    return writeOff(ctx, data, await g.adminActor());
  });

// ── Инвентаризация (core/stock/stocktake) ──

export const stocktakeFn = createServerFn({ method: "GET" })
  .validator((d: unknown) =>
    z
      .object({ page: z.number().int().min(0).max(10_000), q: z.string().max(100).default("") })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse");
    const { loadStocktake, listCountItems, discrepancies } = await import("@/core/stock/stocktake");
    const doc = await loadStocktake(ctx);
    const open = doc && doc.status !== "posted";
    const { items, total } = open
      ? await listCountItems(ctx, doc, { page: data.page, q: data.q })
      : { items: [], total: 0 };
    return {
      session: doc
        ? {
            id: doc.id,
            status: doc.status,
            startedAt: doc.startedAt,
            postedAt: doc.postedAt,
            entered: Object.keys(doc.lines).length,
          }
        : null,
      items,
      total,
      diffs: doc ? await discrepancies(ctx, doc) : [],
    };
  });

export const stocktakeStartFn = createServerFn({ method: "POST" }).handler(async () => {
  const g = await guards();
  const ctx = await g.requireAdminModule("warehouse", "manager");
  const { startStocktake } = await import("@/core/stock/stocktake");
  const doc = await startStocktake(ctx, await g.adminActor());
  return { id: doc.id };
});

export const stocktakeCountFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        id: uuid,
        productId: uuid,
        counted: z.number().int().min(0).max(1_000_000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { setCount } = await import("@/core/stock/stocktake");
    await setCount(ctx, data.id, data.productId, data.counted);
    return { ok: true };
  });

export const stocktakeConfirmFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const g = await guards();
    const ctx = await g.requireAdminModule("warehouse", "manager");
    const { confirmStocktake } = await import("@/core/stock/stocktake");
    const doc = await confirmStocktake(ctx, data.id, await g.adminActor());
    return { changed: Object.values(doc.lines).filter((l) => l.state === "done").length };
  });

export const stocktakeCancelFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data }) => {
    const ctx = await (await guards()).requireAdminModule("warehouse", "manager");
    const { cancelStocktake } = await import("@/core/stock/stocktake");
    await cancelStocktake(ctx, data.id);
    return { ok: true };
  });
