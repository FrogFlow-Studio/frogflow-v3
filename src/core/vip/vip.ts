/**
 * VIP-подписки: платный доступ в закрытую Telegram-группу по тарифам.
 * Ядро не знает Telegram — группа приходит интерфейсом VipGroup, который
 * канал реализует токеном VIP-бота клиента. Все денежные переходы здесь:
 * заявка → чек → подтверждение → инвайт → продление → истечение.
 * Реализация — в соседних модулях.
 */
export {
  type TariffRow,
  type SubscriptionRow,
  type SubscriptionWithTariff,
  type MemberProfileRow,
  type MemberUser,
  type GroupMember,
  type VipGroup,
  VIP_SETTING_KEYS,
  type VipSettings,
  vipSettings,
} from "./vip-model";
export {
  listTariffs,
  renewTariffs,
  entryTariff,
  getTariff,
  type TariffInput,
  saveTariff,
  deleteTariff,
  assignMemberTariff,
  memberAssignedTariff,
  memberLocale,
  setMemberLocale,
} from "./tariffs";
export {
  activeSubscription,
  pendingSubscription,
  hadPaidAccess,
  getSubscription,
  listSubscriptions,
} from "./subscription-queries";
export {
  startPending,
  attachProof,
  type ActivateResult,
  activateSubscription,
  rejectSubscription,
} from "./subscription-payment";
export {
  type ManualWarning,
  addManualSubscription,
  extendSubscription,
  resendInvite,
  excludeMember,
  deleteSubscription,
} from "./subscription-admin";
