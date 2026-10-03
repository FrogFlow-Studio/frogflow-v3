/** Результат «Проверить бота»: типы и коды текстов — без серверных зависимостей, их читает и интерфейс. */

/** ok — в порядке, fail — сломано, unknown — Telegram не ответил (не значит «сломано»). */
export type CheckStatus = "ok" | "fail" | "unknown";
export type CheckItem = {
  key: "token" | "webhook" | "updates" | "commands";
  status: CheckStatus;
  /** Код для текста на языке продавца (app/i18n/admin/settings.ts, settings.tg.check.<код>). */
  code: string;
  params?: Record<string, string | number>;
};
export type BotCheck = {
  /** Клиент не на v2: Telegram не трогаем, проверять нечего. */
  skipped?: "not_v2" | "no_token";
  items: CheckItem[];
  ok: boolean;
};

/**
 * Какие коды бывает у каждого пункта: для каждого есть текст
 * settings.tg.check.<пункт>.<код> на всех четырёх языках (проверяет тест).
 * Код `late` общий — settings.tg.check.late.
 */
export const CHECK_CODES = {
  token: ["ok", "dead", "noReply"],
  webhook: ["ok", "none", "foreign", "error", "noReply"],
  updates: ["ok", "missing", "needWebhook", "noReply"],
  commands: ["ok", "none", "stale", "noReply"],
} as const;

/**
 * Почему «Починить» не удалось: код для текста на языке продавца
 * (settings.tg.repairFailed.<код>); reason — короткая причина от Telegram как есть.
 */
export type InstallError = { code: "telegram"; reason: string } | { code: "unknown" };
