import { randomUUID } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, updateSettingStamped, setSetting } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import { chunksOf } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";

/**
 * Поставщики склада. Схема не меняется: весь список — одна строка
 * `app_settings` `suppliers` (JSON `{rev, items}`), основной поставщик товара —
 * строка `supplier_of:<id товара>` со значением «id поставщика».
 *
 * Список пишут сразу несколько вкладок и сотрудников, поэтому запись условная:
 * экран присылает `rev`, который видел, и если список уже другой — «список
 * изменился», ничего не затирается. Условие в базе — метка `updated_at`
 * (список может быть длинным, целиком в адрес запроса он не пройдёт).
 */
export const SUPPLIERS_KEY = "suppliers";
export const SUPPLIER_OF_PREFIX = "supplier_of:";
export const MAX_SUPPLIERS = 200;

export type Supplier = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  note: string;
};
export type SupplierInput = Omit<Supplier, "id">;
export type SupplierList = { rev: number; items: Supplier[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const supplierOfKey = (productId: string) => `${SUPPLIER_OF_PREFIX}${productId}`;

/** Обрезка и чистка полей: поставщик без названия не бывает. */
export function cleanSupplier(input: Partial<SupplierInput>): SupplierInput | null {
  const name = String(input.name ?? "")
    .trim()
    .slice(0, 120);
  if (!name) return null;
  return {
    name,
    contact: String(input.contact ?? "")
      .trim()
      .slice(0, 120),
    phone: String(input.phone ?? "")
      .trim()
      .slice(0, 40),
    note: String(input.note ?? "")
      .trim()
      .slice(0, 1000),
  };
}

/** Битая или пустая строка — пустой список; сломанные поставщики пропускаются. */
export function parseSuppliers(raw: string | null | undefined): SupplierList {
  try {
    const v = JSON.parse(raw ?? "") as { rev?: unknown; items?: unknown };
    const rev = Number.isInteger(v.rev) && (v.rev as number) >= 0 ? (v.rev as number) : 0;
    const items: Supplier[] = [];
    if (Array.isArray(v.items))
      for (const it of v.items as Array<Partial<Supplier>>) {
        const clean = cleanSupplier(it ?? {});
        if (clean && typeof it.id === "string" && UUID.test(it.id))
          items.push({ id: it.id, ...clean });
      }
    return { rev, items };
  } catch {
    return { rev: 0, items: [] };
  }
}

/** Сбой чтения — сбой, а не «поставщиков нет». */
export async function loadSuppliers(ctx: TenantContext): Promise<SupplierList> {
  return parseSuppliers(await getSettingStrict(ctx, SUPPLIERS_KEY));
}

function staleError(): UserError {
  return new UserError(
    "err.stock.suppliersChanged",
    "Список поставщиков изменился. Обновите страницу и повторите.",
  );
}

/**
 * Изменить список с условием «rev как на экране». `edit` вернул null — отказ
 * (нет такого поставщика). Возвращает новый список.
 */
async function mutate(
  ctx: TenantContext,
  expectedRev: number,
  edit: (items: Supplier[]) => Supplier[] | null,
): Promise<SupplierList> {
  let stale = false;
  let refused = false;
  let result: SupplierList | null = null;
  const r = await updateSettingStamped(ctx, SUPPLIERS_KEY, (raw) => {
    const cur = parseSuppliers(raw);
    if (cur.rev !== expectedRev) {
      stale = true;
      return null;
    }
    const items = edit(cur.items);
    if (!items) {
      refused = true;
      return null;
    }
    result = { rev: cur.rev + 1, items };
    return JSON.stringify(result);
  });
  if (stale) throw staleError();
  if (refused)
    throw new UserError(
      "err.stock.supplierNotFound",
      "Такого поставщика нет — возможно, его уже удалили.",
    );
  if (r !== "written" || !result) throw serverFailure("Список поставщиков не сохранился");
  return result;
}

export async function addSupplier(
  ctx: TenantContext,
  expectedRev: number,
  input: Partial<SupplierInput>,
): Promise<SupplierList> {
  const clean = cleanSupplier(input);
  if (!clean) throw new UserError("err.stock.supplierName", "Укажите название поставщика.");
  return mutate(ctx, expectedRev, (items) => {
    if (items.length >= MAX_SUPPLIERS)
      throw new UserError("err.stock.suppliersMax", "Поставщиков не больше {max}.", {
        max: MAX_SUPPLIERS,
      });
    return [...items, { id: randomUUID(), ...clean }];
  });
}

export async function updateSupplier(
  ctx: TenantContext,
  expectedRev: number,
  id: string,
  input: Partial<SupplierInput>,
): Promise<SupplierList> {
  const clean = cleanSupplier(input);
  if (!clean) throw new UserError("err.stock.supplierName", "Укажите название поставщика.");
  return mutate(ctx, expectedRev, (items) =>
    items.some((s) => s.id === id) ? items.map((s) => (s.id === id ? { id, ...clean } : s)) : null,
  );
}

/** Удалить поставщика и снять его с товаров. */
export async function removeSupplier(
  ctx: TenantContext,
  expectedRev: number,
  id: string,
): Promise<SupplierList> {
  const list = await mutate(ctx, expectedRev, (items) =>
    items.some((s) => s.id === id) ? items.filter((s) => s.id !== id) : null,
  );
  // Поставщика в списке уже нет, так что «висячая» привязка никому не видна
  // (чтение отбрасывает привязки к неизвестным поставщикам); снимаем её, чтобы
  // не копился мусор. Сбой — наружу: продавец повторит, остаток привязок снимется.
  await unlinkSupplier(ctx, id);
  return list;
}

/** Строки `supplier_of:*` с этим поставщиком — постранично, без обрезки. */
async function linksOf(ctx: TenantContext, supplierId: string | null) {
  const rows = await pageAll((from, to) => {
    const q = ctx.db
      .from("app_settings")
      .select("key, value")
      .like("key", `${SUPPLIER_OF_PREFIX}%`)
      .order("key");
    return (supplierId ? q.eq("value", supplierId) : q).range(from, to);
  }, "Привязки поставщиков не прочитались");
  return rows.filter((r) => r.key.startsWith(SUPPLIER_OF_PREFIX));
}

export async function unlinkSupplier(ctx: TenantContext, supplierId: string): Promise<number> {
  const keys = (await linksOf(ctx, supplierId)).map((r) => r.key);
  for (const chunk of chunksOf(keys)) {
    const { error } = await ctx.db.from("app_settings").delete().in("key", chunk);
    if (error) throw serverFailure(`Привязки поставщика не сняты: ${error.message}`);
  }
  return keys.length;
}

/** Основной поставщик товара: id поставщика → товары. Привязки к удалённым не считаются. */
export async function productSuppliers(ctx: TenantContext): Promise<Map<string, string>> {
  const known = new Set((await loadSuppliers(ctx)).items.map((s) => s.id));
  const out = new Map<string, string>();
  for (const r of await linksOf(ctx, null)) {
    const sid = String(r.value ?? "");
    if (known.has(sid)) out.set(r.key.slice(SUPPLIER_OF_PREFIX.length), sid);
  }
  return out;
}

/** Назначить товару основного поставщика; null — снять. */
export async function setProductSupplier(
  ctx: TenantContext,
  productId: string,
  supplierId: string | null,
): Promise<void> {
  if (!UUID.test(productId)) throw new UserError("err.stock.productNotFound", "Товар не найден.");
  const prod = await ctx.db.from("products").select("id").eq("id", productId).maybeSingle();
  if (prod.error) throw serverFailure(`Товар не прочитался: ${prod.error.message}`);
  if (!prod.data) throw new UserError("err.stock.productNotFound", "Товар не найден.");
  if (supplierId === null) {
    const { error } = await ctx.db
      .from("app_settings")
      .delete()
      .eq("key", supplierOfKey(productId));
    if (error) throw serverFailure(`Поставщик товара не снят: ${error.message}`);
    return;
  }
  const list = await loadSuppliers(ctx);
  if (!list.items.some((s) => s.id === supplierId))
    throw new UserError(
      "err.stock.supplierNotFound",
      "Такого поставщика нет — возможно, его уже удалили.",
    );
  await setSetting(ctx, supplierOfKey(productId), supplierId);
}
