/** Кто проверяет чек (settings.delivery.proof_checker): имя для текста «чек получен». */
export const PROOF_CHECKER_MAX = 40;

/** Имя проверяющего из настроек: без разметки, по краям без пробелов, не длиннее предела. */
export function cleanChecker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/[<>&]/g, "").replace(/\s+/g, " ").trim().slice(0, PROOF_CHECKER_MAX);
  return v || null;
}
