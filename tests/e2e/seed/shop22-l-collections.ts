/**
 * Подборка площадки (shop22-l-collections.spec.ts): опубликованная «Для школы Л3» с товаром
 * «Лавки Ш20» и черновик, которого покупатель видеть не должен.
 */
import * as F from "../fixtures.ts";
import type { StubDb } from "../pg-stub.ts";
import { add } from "./util.ts";

export function seedShop22LCollections(db: StubDb, now: string) {
  const C = F.SH22_COLLECTION;
  const item = [{ shop_id: F.SH20_SHOP.id, product_id: F.SH20_PRODUCT.id }];
  add(db, "market_collections", [
    {
      id: C.id,
      title: { ru: C.title },
      items: item,
      position: 0,
      published: true,
      rev: 1,
      created_at: now,
      updated_at: now,
    },
    {
      id: "e2e22000-0000-4000-8000-0000000000c2",
      title: { ru: "Черновик Л3" },
      items: item,
      position: 1,
      published: false,
      rev: 1,
      created_at: now,
      updated_at: now,
    },
  ]);
}
