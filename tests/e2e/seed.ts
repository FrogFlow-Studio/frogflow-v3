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
import { seedShop12Crumbs } from "./seed/shop12-crumbs.ts";
import { seedShop14Cost } from "./seed/shop14-cost.ts";
import { seedShop14Delivery } from "./seed/shop14-delivery.ts";
import { seedShop14Integrations } from "./seed/shop14-integrations.ts";
import { seedShop14FreeDelivery } from "./seed/shop14-free-delivery.ts";
import { seedShop15FreePromo } from "./seed/shop15-free-promo.ts";
import { seedShop15Reschedule } from "./seed/shop15-reschedule.ts";
import { seedShop16Reviews } from "./seed/shop16-reviews.ts";
import { seedShop16Quiz } from "./seed/shop16-quiz.ts";
import { seedShop16OReply } from "./seed/shop16-o-reply.ts";
import { seedShop16OFilters } from "./seed/shop16-o-filters.ts";
import { seedShop16OEngage } from "./seed/shop16-o-engage.ts";
import { seedShop16RAutostats } from "./seed/shop16-r-autostats.ts";
import { seedShop16DChat } from "./seed/shop16-d-chat.ts";

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
  seedShop12Crumbs(db, now);
  seedShop14Cost(db, now);
  seedShop14Delivery(db, now);
  seedShop14Integrations(db, now);
  seedShop14FreeDelivery(db, now);
  seedShop15FreePromo(db, now);
  seedShop15Reschedule(db, now);
  seedShop16Reviews(db, now);
  seedShop16Quiz(db, now);
  seedShop16OReply(db, now);
  seedShop16OFilters(db, now);
  seedShop16OEngage(db, now);
  seedShop16RAutostats(db, now);
  seedShop16DChat(db, now);
  return db;
}
