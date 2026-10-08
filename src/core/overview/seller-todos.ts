import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateSettingStamped } from "@/core/settings/settings";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";

/**
 * Свои задачи продавца в блоке «Что сделать сегодня» (пожелание Кристины,
 * А3): строка «Добавить задачу…», галочка «сделано», удаление. Рядом
 * остаются пункты от системы (core/overview/today).
 *
 * Хранение без изменения схемы — как у задач консультанта: строка
 * `app_settings.seller_todos_json` (JSON-массив) у клиента. Задачи общие для
 * магазина: у каждой видно, кто добавил и кто отметил. Запись условна по
 * `updated_at` (updateSettingStamped): массив бывает больше 8 КБ, условие на
 * всё значение дало бы 431, а правки с двух устройств не затирают друг друга.
 */
export const TODOS_KEY = "seller_todos_json";

/** Открытых задач не больше стольких: лишнюю не добавляем, а не теряем старые молча. */
export const TODOS_LIMIT = 200;

/** Сделанные хранятся месяц, потом уходят из списка при следующей записи. */
export const DONE_KEEP_DAYS = 30;

export const TODO_TEXT_MAX = 300;

export type SellerTodo = {
  /** Id от браузера: повтор того же запроса (двойной Enter) задачу не задваивает. */
  id: string;
  text: string;
  /** День, на который задача («ГГГГ-ММ-ДД», пояс магазина). */
  day: string;
  /** Когда добавили (ISO). */
  at: string;
  /** Логин сотрудника, который добавил. */
  by?: string;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
};

export const TODO_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

function todoFrom(raw: unknown): SellerTodo | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && TODO_ID.test(r.id) ? r.id : null;
  const text = str(r.text, TODO_TEXT_MAX);
  const day = typeof r.day === "string" && DAY.test(r.day) ? r.day : null;
  const at = typeof r.at === "string" && Number.isFinite(Date.parse(r.at)) ? r.at : null;
  if (!id || !text || !day || !at) return null;
  const done = r.done === true;
  return {
    id,
    text,
    day,
    at,
    ...(str(r.by, 100) ? { by: str(r.by, 100) } : {}),
    done,
    ...(done && typeof r.doneAt === "string" && Number.isFinite(Date.parse(r.doneAt))
      ? { doneAt: r.doneAt }
      : {}),
    ...(done && str(r.doneBy, 100) ? { doneBy: str(r.doneBy, 100) } : {}),
  };
}

/** Разбор строки app_settings; пусто или кривой JSON — пустой список, кривые записи пропускаются. */
export function parseTodos(raw: string | null | undefined): SellerTodo[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(todoFrom).filter((t): t is SellerTodo => t !== null);
  } catch {
    return [];
  }
}

/** Убрать сделанные старше DONE_KEEP_DAYS (по отметке, иначе по дате добавления). */
export function pruneDone(list: SellerTodo[], now: Date): SellerTodo[] {
  const edge = new Date(now.getTime() - DONE_KEEP_DAYS * 86_400_000).toISOString();
  return list.filter((t) => !t.done || (t.doneAt ?? t.at) >= edge);
}

/**
 * Как показать: на сегодня (`due`) — открытые с днём не позже сегодняшнего (старые
 * сверху, с отметкой «перенесено»), позже — запланированные вперёд, сделанные
 * — свежие сверху. Порядок заканчивается id, чтобы не прыгал.
 */
export function todoView(list: SellerTodo[], today: string) {
  const open = list.filter((t) => !t.done);
  const byDay = (a: SellerTodo, b: SellerTodo) =>
    a.day.localeCompare(b.day) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id);
  return {
    due: open
      .filter((t) => t.day <= today)
      .sort(byDay)
      .map((t) => ({ ...t, carried: t.day < today })),
    later: open.filter((t) => t.day > today).sort(byDay),
    done: list
      .filter((t) => t.done)
      .sort(
        (a, b) => (b.doneAt ?? b.at).localeCompare(a.doneAt ?? a.at) || a.id.localeCompare(b.id),
      ),
  };
}

/** Прочитать список. Сбой чтения — ошибка, а не «задач нет». */
export async function loadTodos(ctx: TenantContext): Promise<SellerTodo[]> {
  const { data, error } = await ctx.db
    .from("app_settings")
    .select("value")
    .eq("key", TODOS_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`свои задачи не прочитаны: ${error.message}`);
  return parseTodos(data?.value ?? null);
}

export type NewTodo = { id: string; text: string; day: string; by?: string | null };

/**
 * Добавить задачу. Тот же id уже есть (двойной Enter, повтор запроса) —
 * второй раз не пишем. Открытых уже TODOS_LIMIT — отказ с понятным текстом.
 */
export async function addTodo(
  ctx: TenantContext,
  input: NewTodo,
  now = new Date(),
): Promise<SellerTodo> {
  const todo = todoFrom({
    id: input.id,
    text: input.text,
    day: input.day,
    at: now.toISOString(),
    by: input.by ?? undefined,
    done: false,
  });
  if (!todo) throw new UserError("err.todos.empty", "Напишите, что нужно сделать.");
  let full = false;
  const res = await updateSettingStamped(ctx, TODOS_KEY, (raw) => {
    const list = parseTodos(raw);
    full = false;
    if (list.some((t) => t.id === todo.id)) return null;
    const kept = pruneDone(list, now);
    if (kept.filter((t) => !t.done).length >= TODOS_LIMIT) {
      full = true;
      return null;
    }
    // Предел и для сделанных: сначала уходят самые старые из них.
    const done = kept
      .filter((t) => t.done)
      .sort((a, b) => (a.doneAt ?? a.at).localeCompare(b.doneAt ?? b.at));
    const drop = new Set(
      done.slice(0, Math.max(0, kept.length + 1 - TODOS_LIMIT)).map((t) => t.id),
    );
    return JSON.stringify([...kept.filter((t) => !drop.has(t.id)), todo]);
  });
  if (res === "failed") throw serverFailure("свои задачи: задача не записалась");
  if (full)
    throw new UserError(
      "err.todos.full",
      "В списке уже {limit} открытых задач — отметьте или удалите лишние.",
      { limit: TODOS_LIMIT },
    );
  return todo;
}

/** Отметить сделанной или вернуть в работу. Задачи нет — false. */
export async function setTodoDone(
  ctx: TenantContext,
  id: string,
  done: boolean,
  by: string | null,
  now = new Date(),
): Promise<boolean> {
  let found = false;
  const res = await updateSettingStamped(ctx, TODOS_KEY, (raw) => {
    const list = parseTodos(raw);
    const cur = list.find((t) => t.id === id);
    found = Boolean(cur);
    if (!cur || cur.done === done) return null;
    return JSON.stringify(
      pruneDone(list, now).map((t) => {
        if (t.id !== id) return t;
        const { doneAt: _, doneBy: __, ...rest } = t;
        return done
          ? { ...rest, done, doneAt: now.toISOString(), ...(by ? { doneBy: by } : {}) }
          : { ...rest, done };
      }),
    );
  });
  if (res === "failed") throw serverFailure("свои задачи: отметка не записалась");
  return found;
}

/** Удалить задачу. Уже удалена — false. */
export async function removeTodo(ctx: TenantContext, id: string): Promise<boolean> {
  let found = false;
  const res = await updateSettingStamped(ctx, TODOS_KEY, (raw) => {
    const list = parseTodos(raw);
    found = list.some((t) => t.id === id);
    return found ? JSON.stringify(list.filter((t) => t.id !== id)) : null;
  });
  if (res === "failed") throw serverFailure("свои задачи: удаление не записалось");
  return found;
}
