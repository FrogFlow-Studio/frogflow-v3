import type { AdminT } from "@/app/i18n/admin";

/**
 * Сообщения продавцу о подписке — на его языке (ru, kk, en, uz). Шлёт их обход
 * подписок (billing.server.sweepSubscriptions) через бота владельца.
 */
export const subscriptionMessages = {
  /** Напоминание: заканчивается или уже просрочена; хвост — что будет дальше при его политике. */
  warn(t: AdminT, daysLeft: number | null, willSuspend: boolean): string {
    const tail = willSuspend ? t("sub.msg.tailSuspend") : t("sub.msg.tailWarn");
    const head =
      daysLeft !== null && daysLeft >= 0
        ? t("sub.msg.warnLeft", { n: daysLeft })
        : t("sub.msg.warnOver", { n: daysLeft === null ? 0 : -daysLeft });
    return `${head}\n\n${tail}`;
  },
  suspended(t: AdminT, daysLeft: number | null): string {
    return t("sub.msg.suspended", { n: daysLeft === null ? 0 : Math.max(0, -daysLeft) });
  },
};
