/**
 * Заметки и задачи оператора по клиенту. Хранение — `app_settings` клиента
 * (схема заморожена): ключ `op_note:<uuid>` / `op_task:<uuid>`, значение —
 * небольшой JSON. v1 этих ключей не читает. Чистая часть: разбор, проверка
 * ввода и «что на сегодня».
 */
export const NOTE_PREFIX = "op_note:";
export const TASK_PREFIX = "op_task:";
export const NOTE_MAX = 4000;
export const TASK_MAX = 500;
/** Метка открытой задачи в значении — по ней закрытие идёт условным обновлением. */
export const OPEN_MARK = '"status":"open"';

export type ClientNote = { id: string; text: string; at: string };
export type ClientTask = {
  id: string;
  text: string;
  /** YYYY-MM-DD в часовом поясе платформы. */
  due: string;
  status: "open" | "done";
  at: string;
  doneAt: string | null;
};

export const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validDue(due: string): boolean {
  if (!DUE_RE.test(due)) return false;
  const d = new Date(`${due}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().startsWith(due);
}

/** Порядок полей в JSON фиксирован: `status` стоит первым, шаблон OPEN_MARK его находит. */
export function taskValue(t: Omit<ClientTask, "id">): string {
  return JSON.stringify({
    status: t.status,
    due: t.due,
    text: t.text,
    at: t.at,
    doneAt: t.doneAt,
  });
}

export function noteValue(n: Omit<ClientNote, "id">): string {
  return JSON.stringify({ text: n.text, at: n.at });
}

function parse(value: string | null): Record<string, unknown> | null {
  try {
    const v = value ? (JSON.parse(value) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseTask(key: string, value: string | null): ClientTask | null {
  const v = parse(value);
  if (!v || typeof v.text !== "string" || typeof v.due !== "string" || !validDue(v.due))
    return null;
  return {
    id: key.slice(TASK_PREFIX.length),
    text: v.text,
    due: v.due,
    status: v.status === "done" ? "done" : "open",
    at: typeof v.at === "string" ? v.at : "",
    doneAt: typeof v.doneAt === "string" ? v.doneAt : null,
  };
}

export function parseNote(key: string, value: string | null): ClientNote | null {
  const v = parse(value);
  if (!v || typeof v.text !== "string") return null;
  return {
    id: key.slice(NOTE_PREFIX.length),
    text: v.text,
    at: typeof v.at === "string" ? v.at : "",
  };
}

/** Открытые задачи на сегодня и просроченные; раньше по сроку — выше. */
export function dueNow<T extends { due: string; status: string }>(tasks: T[], today: string): T[] {
  return tasks
    .filter((t) => t.status === "open" && t.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due));
}
