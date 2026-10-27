/** Серверная часть кабинета оператора. Реализация — в соседних модулях `*.server.ts`. */
export { logEvent } from "./client-log.server";
export {
  type ClientStats,
  clientStats,
  type ClientView,
  listClients,
  getClient,
} from "./client-list.server";
export {
  zernioLastEvents,
  type EventView,
  listEvents,
  type PlatformEvent,
  listAllEvents,
} from "./client-events.server";
export {
  type MigrationCandidate,
  preflightAll,
  setServedByBulk,
  updateClientMeta,
  setStatus,
  setModule,
  connectTelegram,
  connectVipBot,
  disconnectVipBot,
  setServedBy,
  importLegacyStoryTags,
  reinstallWebhook,
  webhookState,
  setAddressing,
  setZernioAccounts,
  setAdminCredentials,
} from "./client-settings.server";
export { createClient, archiveClient } from "./client-create.server";
export {
  notifyOwner,
  type OwnerMessageDraft,
  ownerMessageDraft,
  type OwnerMessageLogItem,
  listOwnerMessages,
} from "./owner-messages.server";
export {
  type ModuleRequestView,
  listModuleRequests,
  pendingModuleRequestCount,
  resolveModuleRequest,
} from "./module-requests.server";
export {
  type OwnerDelivery,
  broadcastToOwners,
  type OwnerBroadcastView,
  listOwnerBroadcasts,
} from "./owner-broadcasts.server";
export {
  consultantBudget,
  setMarketplaceHidden,
  setMarketplaceApproved,
  setConsultantSearch,
  setConsultantPlaybook,
  setConsultantCacheWarm,
  setConsultantPricelist,
  setConsultantPricelistOptions,
  smartSearchBudget,
  setSmartSearchLimit,
  setConsultantLimits,
} from "./client-consultant.server";
export { type ShopGroupView, shopGroupView, linkShops, unlinkShop } from "./shop-groups.server";
