/**
 * База сквозного прогона, собранная из разделов в seed/: у каждого раздела
 * свой файл, чтобы новые сценарии дописывали свой раздел, а не общий файл.
 * Раздел, которому нужен бот магазина, идёт после seedShop.
 */
import { stubDb, type StubDb } from "./pg-stub.ts";
import { seedBase } from "./seed/base.ts";
import { seedWhatsapp } from "./seed/whatsapp.ts";
import { seedConsultant } from "./seed/consultant.ts";
import { seedCommentToDm } from "./seed/comment-to-dm.ts";
import { seedInstagram } from "./seed/instagram.ts";
import { seedOperator } from "./seed/operator.ts";
import { seedShop } from "./seed/shop.ts";
import { seedStorefront } from "./seed/storefront.ts";
import { seedVip } from "./seed/vip.ts";
import { seedSchool } from "./seed/school.ts";
import { seedLeads } from "./seed/leads.ts";
import { seedShop4Waitlist } from "./seed/shop4-waitlist.ts";
import { seedShop4Filters } from "./seed/shop4-filters.ts";
import { seedShop4Chat } from "./seed/shop4-chat.ts";
import { seedShop4Sale } from "./seed/shop4-sale.ts";

export function seedDb(): StubDb {
  const db = stubDb();
  const now = new Date().toISOString();
  seedBase(db);
  seedOperator(db);
  seedShop(db, now);
  seedStorefront(db, now);
  seedInstagram(db);
  seedVip(db, now);
  seedWhatsapp(db);
  seedConsultant(db, now);
  seedCommentToDm(db, now);
  seedSchool(db, now);
  seedLeads(db, now);
  seedShop4Waitlist(db, now);
  seedShop4Chat(db, now);
  seedShop4Filters(db, now);
  seedShop4Sale(db, now);
  return db;
}
