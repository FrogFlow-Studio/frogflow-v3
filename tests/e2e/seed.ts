/**
 * База сквозного прогона, собранная из разделов в seed/: у каждого раздела
 * свой файл, чтобы новые сценарии дописывали свой раздел, а не общий файл.
 * Раздел, которому нужен бот магазина, идёт после seedShop.
 */
import { stubDb, type StubDb } from "./pg-stub.ts";
import { seedBase } from "./seed/base.ts";
import { seedInstagram } from "./seed/instagram.ts";
import { seedOperator } from "./seed/operator.ts";
import { seedShop } from "./seed/shop.ts";
import { seedStorefront } from "./seed/storefront.ts";
import { seedVip } from "./seed/vip.ts";

export function seedDb(): StubDb {
  const db = stubDb();
  const now = new Date().toISOString();
  seedBase(db);
  seedOperator(db);
  seedShop(db, now);
  seedStorefront(db, now);
  seedInstagram(db);
  seedVip(db, now);
  return db;
}
