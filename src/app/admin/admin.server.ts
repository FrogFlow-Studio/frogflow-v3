/** Серверная часть админки. Реализация — в соседних модулях `admin-team`, `customer-notify`, `order-actions`, `manager-reply` (`*.server.ts`). */
export {
  resolveAdminLogin,
  checkAdminPassword,
  type TeamMember,
  listTeam,
  saveTeamMember,
  deleteTeamMember,
} from "./admin-team.server";
export {
  notifyCustomer,
  runOrderTracking,
  assembleOrdersAndNotify,
} from "./customer-notify.server";
export {
  type OrderAction,
  dispatchCourier,
  sendApprovalPhoto,
  refundAndNotify,
  runOrderAction,
} from "./order-actions.server";
export { replyAsManager, pauseBotAfterManagerReply } from "./manager-reply.server";
