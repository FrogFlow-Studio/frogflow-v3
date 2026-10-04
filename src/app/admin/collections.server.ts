import type { TenantContext } from "@/core/tenant/resolve.server";
import { productsByIds } from "@/core/catalog/picker";
import { storeProductsByIds } from "@/core/storefront/catalog";
import {
  collectionUrl,
  parseCollections,
  removeCollection,
  upsertCollection,
  type Collection,
  type CollectionInput,
} from "@/core/storefront/collections";
import { storefrontBase } from "@/core/tenant/custom-domain";

/**
 * Подборки в админке. Список читаем из bots.settings магазина, пишем через
 * patchTenantSettings (остальные ключи клиента не затираются, rev растёт).
 */
export type AdminCollection = {
  id: string;
  name: string;
  url: string | null;
  products: Array<{ id: string; name: string; state: "ok" | "hidden" | "gone" }>;
};

export async function adminCollections(ctx: TenantContext): Promise<AdminCollection[]> {
  const list = parseCollections(ctx.tenant.settings.collections);
  const ids = [...new Set(list.flatMap((c) => c.product_ids))];
  // Что покупатель видит сейчас, и названия всех выбранных (в том числе скрытых).
  const [known, visible] = await Promise.all([
    productsByIds(ctx, ids),
    storeProductsByIds(ctx, ids),
  ]);
  const names = new Map(known.map((p) => [p.id, p.name]));
  const shown = new Set(visible.map((p) => p.id));
  // Адреса витрины нет (нет slug) — ссылки нет, подборку не откроют.
  const base = ctx.tenant.settings.slug ? storefrontBase(ctx.tenant, ctx.appUrl) : null;
  return list.map((c) => ({
    id: c.id,
    name: c.name,
    url: base ? collectionUrl(base, c.id) : null,
    products: c.product_ids.map((id) => ({
      id,
      name: names.get(id) ?? "",
      state: !names.has(id) ? "gone" : shown.has(id) ? "ok" : "hidden",
    })),
  }));
}

async function write(ctx: TenantContext, list: Collection[]): Promise<void> {
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(ctx.tenant.id, { collections: list });
}

export async function saveCollection(ctx: TenantContext, input: CollectionInput): Promise<string> {
  const { list, id } = upsertCollection(
    parseCollections(ctx.tenant.settings.collections),
    input,
    new Date().toISOString(),
  );
  await write(ctx, list);
  return id;
}

export async function deleteCollection(ctx: TenantContext, id: string): Promise<void> {
  await write(ctx, removeCollection(parseCollections(ctx.tenant.settings.collections), id));
}
