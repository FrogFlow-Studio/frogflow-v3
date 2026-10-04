/**
 * Запись мастера подключения канала в bots.settings.zernio.wizard
 * (channels/zernio/wizard): на каком шаге и из-за чего канал застрял.
 * Лежит в ядре, потому что settingsFromJson разбирает её вместе с остальным.
 */
export type WizardPlatform = "instagram" | "whatsapp";
export const WIZARD_PLATFORMS: readonly WizardPlatform[] = ["instagram", "whatsapp"];

export type WizardStep = "login" | "webhook" | "test" | "done";
export const WIZARD_STEPS: readonly WizardStep[] = ["login", "webhook", "test", "done"];

/**
 * Почему шаг не пройден; каждому коду — своя подсказка продавцу
 * (i18n `wizard.problem.<код>`) и своя строка оператору.
 * - not_configured — на платформе нет ключа Zernio (чинит оператор);
 * - conflict — аккаунт уже подключён другому магазину;
 * - expired — вход слетел, нужно войти снова;
 * - unsure — запрос к Zernio мог дойти (500, обрыв): сначала «Проверить»;
 * - try_later — Zernio занят или недоступен, запрос точно не прошёл;
 * - refused — Zernio отказал (ключ, права): повтор не поможет;
 * - webhook_off — вебхук платформы ещё не привязан к магазину (кнопка оператора);
 * - webhook_error — вебхук не удалось прочитать.
 */
export type WizardProblem =
  | "not_configured"
  | "conflict"
  | "expired"
  | "unsure"
  | "try_later"
  | "refused"
  | "webhook_off"
  | "webhook_error";

export type WizardEntry = {
  step: WizardStep;
  /** Когда мастер встал на этот шаг (ISO). */
  at: string;
  /** Когда продавец начал подключение (ISO). */
  started_at: string;
  problem?: WizardProblem;
  /** Тест: ждём сообщение, написанное после этого момента. */
  test_since?: string;
  /** Тест: сообщение пришло. */
  test_at?: string;
};
export type WizardMap = Partial<Record<WizardPlatform, WizardEntry>>;

const PROBLEMS: readonly WizardProblem[] = [
  "not_configured",
  "conflict",
  "expired",
  "unsure",
  "try_later",
  "refused",
  "webhook_off",
  "webhook_error",
];

const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** Запись из сырого jsonb: неизвестное отбрасывается, а не ломает страницу. */
export function parseWizardMap(raw: unknown): WizardMap | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: WizardMap = {};
  for (const p of WIZARD_PLATFORMS) {
    const e = (raw as Record<string, unknown>)[p];
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    const step = WIZARD_STEPS.find((s) => s === o.step);
    const at = iso(o.at);
    const startedAt = iso(o.started_at);
    if (!step || !at || !startedAt) continue;
    const problem = PROBLEMS.find((x) => x === o.problem);
    out[p] = {
      step,
      at,
      started_at: startedAt,
      ...(problem ? { problem } : {}),
      ...(iso(o.test_since) ? { test_since: iso(o.test_since) } : {}),
      ...(iso(o.test_at) ? { test_at: iso(o.test_at) } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}
