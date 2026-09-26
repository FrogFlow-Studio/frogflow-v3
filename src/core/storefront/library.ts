import { imagePath } from "@/core/catalog/image-url";

/**
 * «Мои материалы» с актуальным видом товара, как в Mini App v1
 * (tests/mini-app-library.test.ts): продавец переименовал товар или сменил
 * обложку — библиотека показывает новое. Товар удалён — остаётся название
 * из заказа, без обложки. Сами файлы всегда из снимка заказа: покупатель
 * получает то, что купил.
 */
export type LibraryEntry = {
  orderNo: number;
  item: string;
  name: string;
  url: string;
  /** Язык файла (ru, kk…). */
  lang: string;
  /** Обложка товара сейчас; null — картинок нет или товар удалён. */
  cover: string | null;
};

export type LiveProduct = {
  id: string;
  name: string;
  product_images?: Array<{ image_path: string; sort_order: number }> | null;
};

export function freshLibrary(
  tenantId: string,
  entries: ReadonlyArray<Omit<LibraryEntry, "cover"> & { productId: string | null }>,
  products: readonly LiveProduct[],
): LibraryEntry[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return entries.map(({ productId, ...e }) => {
    const p = productId ? byId.get(productId) : undefined;
    const img = (p?.product_images ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)[0];
    return {
      ...e,
      item: p?.name?.trim() || e.item,
      cover: img ? imagePath(tenantId, img.image_path) : null,
    };
  });
}
