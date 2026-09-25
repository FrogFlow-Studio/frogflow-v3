import { MODULES, type ModuleKey } from "@/core/modules/registry";

/**
 * Предполётная проверка перед переводом клиента на v2 — чистая часть:
 * что блокирует переезд, что стоит поправить, что напомнить. Сбор входных
 * данных (getMe, счётчики) — в app/operator/migration.server.ts.
 */
export type PreflightLevel = "ok" | "info" | "warn" | "block";
export type PreflightCheck = { key: string; level: PreflightLevel; title: string; detail: string };
export type Preflight = { ready: boolean; checks: PreflightCheck[] };

export type PreflightInput = {
  modulesOn: ModuleKey[];
  tokenPresent: boolean;
  /** null — не проверяли (токена нет). */
  tokenOk: boolean | null;
  botUsername: string | null;
  paymentMethods: number;
  products: number;
  adminLogin: boolean;
  /** Адрес деплоя v1 — напоминание поставить его крон на паузу. */
  appUrl: string | null;
};

export function evaluatePreflight(i: PreflightInput): Preflight {
  const checks: PreflightCheck[] = [];
  const planned = i.modulesOn.filter((k) => MODULES[k].status === "planned");
  checks.push(
    planned.length
      ? {
          key: "modules",
          level: "block",
          title: "Не все модули перенесены",
          detail: `Включены, но в v2 их ещё нет: ${planned.map((k) => MODULES[k].title).join(", ")}. Выключите их или подождите переноса.`,
        }
      : {
          key: "modules",
          level: "ok",
          title: "Модули перенесены",
          detail: `Все ${i.modulesOn.length} включённых модулей есть в v2.`,
        },
  );
  if (!i.tokenPresent)
    checks.push({
      key: "token",
      level: "block",
      title: "Нет токена бота",
      detail: "Подключите Telegram токеном из проекта Vercel клиента (TELEGRAM_BOT_TOKEN).",
    });
  else if (i.tokenOk === false)
    checks.push({
      key: "token",
      level: "block",
      title: "Токен не отвечает",
      detail: "Telegram отклонил токен (getMe). Проверьте, что он не отозван в BotFather.",
    });
  else
    checks.push({
      key: "token",
      level: "ok",
      title: `Бот отвечает${i.botUsername ? ` — @${i.botUsername}` : ""}`,
      detail: "Токен проверен через getMe.",
    });
  checks.push(
    i.paymentMethods > 0 || i.modulesOn.includes("robokassa")
      ? {
          key: "payments",
          level: "ok",
          title: "Оплата настроена",
          detail: i.paymentMethods > 0 ? `Реквизитов: ${i.paymentMethods}.` : "Robokassa.",
        }
      : {
          key: "payments",
          level: "warn",
          title: "Нет реквизитов оплаты",
          detail: "Покупатель не сможет оформить заказ. Реквизиты по странам — в админке продавца.",
        },
  );
  checks.push(
    i.products > 0
      ? {
          key: "products",
          level: "ok",
          title: "Товары есть",
          detail: `Активных товаров: ${i.products}.`,
        }
      : {
          key: "products",
          level: "warn",
          title: "Нет активных товаров",
          detail: "Каталог в боте будет пустым.",
        },
  );
  checks.push(
    i.adminLogin
      ? {
          key: "admin",
          level: "ok",
          title: "Логин продавца задан",
          detail: "Продавец сможет войти в админку v2.",
        }
      : {
          key: "admin",
          level: "warn",
          title: "Нет логина продавца",
          detail: "Задайте логин и пароль в карточке — иначе продавцу некуда войти после переезда.",
        },
  );
  if (i.appUrl)
    checks.push({
      key: "v1",
      level: "info",
      title: "Остановите крон v1 после переезда",
      detail: `Деплой ${i.appUrl} каждый час ставит вебхук обратно. Поставьте проект Vercel на паузу или удалите крон ensure-webhook.`,
    });
  return { ready: !checks.some((c) => c.level === "block"), checks };
}

export function preflightBlockers(p: Preflight): string[] {
  return p.checks.filter((c) => c.level === "block").map((c) => c.title);
}
