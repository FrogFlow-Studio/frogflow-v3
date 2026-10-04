import { type WizardEntry, type WizardProblem, type WizardStep } from "@/core/tenant/wizard-entry";
import { classifyZernioFailure, connectFailed, ZernioApiError, type ZernioFailure } from "./errors";

/**
 * Мастер подключения канала: «выберите канал → войдите → проверка вебхука →
 * тестовое сообщение». Шаг не хранится как «пройдено»: он выводится из
 * фактов (аккаунт в снимке, вебхук, пришедшее сообщение), поэтому после
 * сбоя, закрытой вкладки или переподключения мастер сам встаёт на нужный
 * шаг. В настройках остаётся только запись для оператора: на каком шаге
 * и из-за чего канал застрял (settings.zernio.wizard).
 */
export type WizardFacts = {
  /** На платформе есть ключ Zernio. */
  configured: boolean;
  /** Аккаунт этого канала в снимке магазина; null — не подключён. */
  account: { expired: boolean } | null;
  /** Аккаунт этого канала в профиле есть, но записан у другого магазина. */
  conflict: boolean;
  /** Общий вебхук v2 привязан к профилю магазина. */
  webhook: "ok" | "off" | "error";
  /** Тестовое сообщение дошло. */
  testReceived: boolean;
};

export type WizardView = { step: WizardStep; problem?: WizardProblem };

/** Шаг и причина по фактам. Порядок важен: пока не вошли, вебхук не проверяем. */
export function evaluateWizard(f: WizardFacts): WizardView {
  if (!f.configured) return { step: "login", problem: "not_configured" };
  if (f.conflict) return { step: "login", problem: "conflict" };
  if (!f.account) return { step: "login" };
  if (f.account.expired) return { step: "login", problem: "expired" };
  if (f.webhook === "off") return { step: "webhook", problem: "webhook_off" };
  if (f.webhook === "error") return { step: "webhook", problem: "webhook_error" };
  if (!f.testReceived) return { step: "test" };
  return { step: "done" };
}

/**
 * Отказ Zernio при подключении → причина для продавца. Только через
 * errors.ts: ветвимся по классу отказа, не по тексту. Обрыв и 500 —
 * «unsure»: запрос мог пройти, слепого повтора нет (профиль при повторе
 * ищется по имени, второй не создаётся — connect.server ensureTenantProfile).
 */
export function problemOfFailure(f: ZernioFailure): WizardProblem {
  switch (classifyZernioFailure(f)) {
    case "ambiguous":
      return "unsure";
    case "temporary":
    case "rate_limited":
      return "try_later";
    default:
      return "refused";
  }
}

/** Ошибка вызова Zernio, которую мастер объясняет сам; остальное — сбой, его не прячем. */
export function explainableFailure(e: unknown): ZernioFailure | null {
  if (e instanceof ZernioApiError) return e.failure;
  if (connectFailed(e)) return { status: null, code: "connect_failed" };
  return null;
}

/** Нужно ли писать запись: тот же шаг и та же причина — не пишем (страницу открывают часто). */
export function entryChanged(
  prev: WizardEntry | undefined,
  next: { step: WizardStep; problem?: WizardProblem },
): boolean {
  return !prev || prev.step !== next.step || prev.problem !== next.problem;
}
