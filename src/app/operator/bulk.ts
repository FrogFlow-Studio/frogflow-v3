/**
 * Массовые действия оператора над клиентами: чистая часть — ввод, подтверждение
 * числом, ключи «один раз». Выполнение — в bulk.server.ts.
 */
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";
import { TRIAL_EXTEND_MAX_DAYS } from "@/core/plans/registry";

/** За один вызов — не больше: дальше оператор сужает фильтр, а не теряет хвост молча. */
export const BULK_MAX = 500;
/** Общий бюджет одного вызова: функция живёт меньше 120 с. */
export const BULK_BUDGET_MS = 100_000;
export const BULK_MESSAGE_MAX = 3500;

export type BulkAction =
  | { kind: "message"; text: string }
  | { kind: "extend"; days: number }
  | { kind: "module"; module: string };

export type BulkStatus = "done" | "skipped" | "failed" | "deferred";
export type BulkResult = { botId: string; name: string; status: BulkStatus; note: string };

/** Модули, которые можно включать массово: только готовые. */
export const BULK_MODULES = MODULE_KEYS.filter((k) => moduleDef(k).status === "available");

/** Ввод числа клиентов для подтверждения: цифры, пробелы по краям не мешают. */
export function confirmMatches(typed: string, n: number): boolean {
  return /^\d+$/.test(typed.trim()) && Number(typed.trim()) === n;
}

export function checkAction(a: BulkAction): string | null {
  if (a.kind === "message") {
    const t = a.text.trim();
    if (!t) return "Пустое сообщение.";
    if (t.length > BULK_MESSAGE_MAX) return `Сообщение длиннее ${BULK_MESSAGE_MAX} знаков.`;
    return null;
  }
  if (a.kind === "extend") {
    if (!Number.isInteger(a.days) || a.days < 1 || a.days > TRIAL_EXTEND_MAX_DAYS)
      return `Продлить можно на 1–${TRIAL_EXTEND_MAX_DAYS} дней за раз.`;
    return null;
  }
  return (BULK_MODULES as readonly string[]).includes(a.module)
    ? null
    : "Этот модуль включить массово нельзя.";
}

/** Метка «клиенту писали сегодня»: одна на клиента и день, в `app_settings`. */
export const messageDayKey = (day: string) => `op_bulk_msg:${day}`;
/** Метка «этот запуск продлил клиента»: повтор того же запуска ничего не делает. */
export const extendBatchKey = (batchId: string) => `op_bulk_extend:${batchId}`;
