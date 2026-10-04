/**
 * Общий бюджет времени одного запроса продавца. Функция сервера живёт меньше
 * 120 с, а рассылки внутри неё (перенос предзаказа, лист ожидания) имеют каждая
 * свой бюджет: идя друг за другом, они вместе вышли бы за предел. Этапы берут
 * остаток общего бюджета, а то, что не успели, остаётся в итоге (`left`).
 */
export const REQUEST_BUDGET_MS = 100_000;

export function requestBudget(totalMs = REQUEST_BUDGET_MS, clock: () => number = Date.now) {
  const started = clock();
  return {
    /** Сколько осталось (не меньше 0). */
    left: () => Math.max(0, totalMs - (clock() - started)),
  };
}
