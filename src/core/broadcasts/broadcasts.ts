/** Рассылки. Реализация — в соседних модулях `broadcast-*.ts`. */
export {
  type BroadcastRow,
  type AudienceFilter,
  type BroadcastChannel,
  MAX_SCHEDULED,
} from "./broadcast-model";
export {
  type WhatsAppRecipient,
  parseExcludedPhones,
  resolveWhatsAppAudience,
  BUYER_STATUSES,
  resolveAudience,
  audienceCountries,
} from "./broadcast-audience";
export {
  type WhatsAppTemplateRef,
  type CreateBroadcastInput,
  type CreateBroadcastResult,
  createBroadcast,
} from "./broadcast-create";
export {
  type BroadcastRecipient,
  type BroadcastSender,
  textForLocale,
  contentOf,
  type BatchResult,
  processBroadcastBatch,
  isDue,
} from "./broadcast-batch";
export {
  cancelBroadcast,
  BROADCASTS_PAGE,
  listBroadcasts,
  hasActiveBroadcast,
} from "./broadcast-list";
