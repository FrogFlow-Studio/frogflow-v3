import type { Preflight, PreflightCheck } from "./preflight";

/**
 * Предполётная проверка VIP-бота (модуль vip: второй бот, платные подписки
 * в закрытую группу). Отдельно от основного списка: у VIP свой токен, и
 * если он не перенесён, после переключения VIP-бот замолчит, а продление
 * подписок встанет. Сбор входных данных — в app/operator/migration.server.ts.
 */
export type VipPreflightInput = {
  /** settings.vip.token_enc записан. */
  tokenPresent: boolean;
  /** getMe VIP-токеном; null — не проверяли (токена нет). */
  tokenOk: boolean | null;
  username: string | null;
  /** getMe основного токена вернул того же бота — VIP-токен перепутан с основным. */
  sameAsMain: boolean;
  /** app_settings.vip_group_id задан: без него не выдать ссылку и не продлить подписку. */
  groupSet: boolean;
  /** Кому бот шлёт чеки VIP с кнопками «Подтвердить» (admin_chat_id и владелец). */
  sellerChats: number;
};

export function vipPreflightChecks(v: VipPreflightInput): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  if (!v.tokenPresent)
    checks.push({
      key: "vip_token",
      level: "block",
      title: "Нет токена VIP-бота",
      detail:
        "Модуль VIP включён, а токена второго бота нет. Подключите его в карточке клиента (токен VIP-бота из проекта Vercel клиента), иначе после переезда VIP-бот замолчит и продление подписок встанет.",
    });
  else if (v.tokenOk === false)
    checks.push({
      key: "vip_token",
      level: "block",
      title: "Токен VIP-бота не отвечает",
      detail: "Telegram отклонил токен VIP-бота (getMe). Проверьте, что он не отозван в BotFather.",
    });
  else if (v.sameAsMain)
    checks.push({
      key: "vip_token",
      level: "block",
      title: "Токен VIP-бота совпадает с основным",
      detail:
        "Под VIP записан токен основного бота магазина. Нужен токен второго, VIP-бота: иначе вебхук VIP перехватит основной бот.",
    });
  else
    checks.push({
      key: "vip_token",
      level: "ok",
      title: `VIP-бот отвечает${v.username ? ` — @${v.username}` : ""}`,
      detail: "Токен VIP-бота проверен через getMe.",
    });
  if (!v.groupSet)
    checks.push({
      key: "vip_group",
      level: "block",
      title: "Не задана VIP-группа",
      detail:
        "В настройках VIP нет id закрытой группы: бот не выдаст ссылку после оплаты, а крон продления не запустится.",
    });
  if (v.sellerChats === 0)
    checks.push({
      key: "vip_chat",
      level: "warn",
      title: "Чеки VIP некому подтверждать",
      detail:
        "Не заданы чат продавца (admin_chat_id) и владелец из карточки: чеки за подписку никто не увидит. Продавец должен ещё и нажать /start у VIP-бота, иначе тот не сможет ему написать.",
    });
  return checks;
}

/** Добавить пункты VIP к общей проверке: перед напоминанием про v1, которое всегда последнее. */
export function withVipChecks(p: Preflight, vip: VipPreflightInput | null): Preflight {
  if (!vip) return p;
  const extra = vipPreflightChecks(vip);
  const v1 = p.checks.findIndex((c) => c.key === "v1");
  const checks =
    v1 < 0 ? [...p.checks, ...extra] : [...p.checks.slice(0, v1), ...extra, ...p.checks.slice(v1)];
  return { ready: !checks.some((c) => c.level === "block"), checks };
}
