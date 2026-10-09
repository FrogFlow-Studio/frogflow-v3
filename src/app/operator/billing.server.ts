/**
 * Подписка клиента на платформу: платежи (subscription_payments — срок
 * bots.subscription_expires_at пересчитывает триггер, второго источника
 * истины нет) и счета владельцу (subscription_invoices): выставлено → чек
 * прислан → подтверждено или отклонено. Подтверждение не изобретает свою
 * бухгалтерию — заводит обычный платёж.
 * Реализация — в соседних модулях `billing-*.server.ts`,
 * `invoice-decisions.server.ts` и `subscription-sweep.server.ts`.
 */
export {
  getPayoutRequisites,
  setPayoutRequisites,
  setPayoutRecipient,
  getKaspiPayLink,
  setKaspiPayLink,
} from "./billing-settings.server";
export {
  type Payment,
  listPayments,
  type NewPayment,
  subscriptionExpiresAt,
  addPayment,
  deletePayment,
} from "./billing-payments.server";
export {
  type InvoiceStatus,
  type Invoice,
  listInvoices,
  createInvoice,
  invoiceProofUrl,
} from "./billing-invoices.server";
export {
  confirmInvoice,
  settleInvoiceProof,
  rejectInvoice,
  cancelInvoice,
} from "./invoice-decisions.server";
export {
  type SweepAction,
  type SweepEntry,
  type SweepNotify,
  type SweepInvoicer,
  sweepSubscriptions,
  setOverduePolicy,
} from "./subscription-sweep.server";
