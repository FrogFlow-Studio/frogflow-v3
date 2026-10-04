import { randomUUID } from "node:crypto";
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { localDayHour } from "./morning-brief";
import {
  NOTE_MAX,
  NOTE_PREFIX,
  OPEN_MARK,
  TASK_MAX,
  TASK_PREFIX,
  dueNow,
  noteValue,
  parseNote,
  parseTask,
  taskValue,
  validDue,
  type ClientNote,
  type ClientTask,
} from "./client-notes";

const rows = (botId: string | null, prefix: string, onlyOpen = false) =>
  pageAll<{ bot_id: string | null; key: string; value: string | null }>((from, to) => {
    let q = serviceDb().from("app_settings").select("bot_id, key, value").like("key", `${prefix}%`);
    if (botId) q = q.eq("bot_id", botId);
    // Условие на короткую метку, не на весь JSON: длинный адрес даёт 431.
    if (onlyOpen) q = q.like("value", `%${OPEN_MARK}%`);
    return q.order("bot_id", { ascending: true }).order("key", { ascending: true }).range(from, to);
  }, "[заметки оператора] чтение");

export async function listClientNotes(botId: string): Promise<{
  notes: ClientNote[];
  tasks: ClientTask[];
}> {
  const [n, t] = await Promise.all([rows(botId, NOTE_PREFIX), rows(botId, TASK_PREFIX)]);
  return {
    notes: n
      .map((r) => parseNote(r.key, r.value))
      .filter((x): x is ClientNote => !!x)
      .sort((a, b) => b.at.localeCompare(a.at)),
    tasks: t
      .map((r) => parseTask(r.key, r.value))
      .filter((x): x is ClientTask => !!x)
      .sort((a, b) =>
        a.status === b.status ? a.due.localeCompare(b.due) : a.status === "open" ? -1 : 1,
      ),
  };
}

export async function addClientNote(botId: string, text: string, now = new Date()) {
  const clean = text.trim();
  if (!clean || clean.length > NOTE_MAX) throw serverFailure(`Заметка: от 1 до ${NOTE_MAX} знаков`);
  const { error } = await serviceDb()
    .from("app_settings")
    .insert({
      bot_id: botId,
      key: `${NOTE_PREFIX}${randomUUID()}`,
      value: noteValue({ text: clean, at: now.toISOString() }),
    });
  if (error) throw serverFailure(`[заметки оператора] не записана: ${error.message}`);
}

export async function deleteClientNote(botId: string, id: string) {
  const { error } = await serviceDb()
    .from("app_settings")
    .delete()
    .eq("bot_id", botId)
    .eq("key", `${NOTE_PREFIX}${id}`);
  if (error) throw serverFailure(`[заметки оператора] не удалена: ${error.message}`);
}

export async function addClientTask(botId: string, text: string, due: string, now = new Date()) {
  const clean = text.trim();
  if (!clean || clean.length > TASK_MAX) throw serverFailure(`Задача: от 1 до ${TASK_MAX} знаков`);
  if (!validDue(due)) throw serverFailure("Задача: срок — дата ГГГГ-ММ-ДД");
  const { error } = await serviceDb()
    .from("app_settings")
    .insert({
      bot_id: botId,
      key: `${TASK_PREFIX}${randomUUID()}`,
      value: taskValue({ text: clean, due, status: "open", at: now.toISOString(), doneAt: null }),
    });
  if (error) throw serverFailure(`[заметки оператора] задача не записана: ${error.message}`);
}

/**
 * Закрыть задачу один раз: обновление условное по метке «открыта». Двойной клик
 * или две вкладки — выигрывает одно обновление, второе получает `closed: false`.
 */
export async function closeClientTask(
  botId: string,
  id: string,
  now = new Date(),
): Promise<{ closed: boolean }> {
  const key = `${TASK_PREFIX}${id}`;
  const db = serviceDb();
  const { data, error } = await db
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", botId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw serverFailure(`[заметки оператора] задача не прочитана: ${error.message}`);
  const task = data ? parseTask(data.key, data.value) : null;
  if (!task) throw serverFailure("Задача не найдена");
  if (task.status === "done") return { closed: false };
  const value = taskValue({ ...task, status: "done", doneAt: now.toISOString() });
  const upd = await db
    .from("app_settings")
    .update({ value, updated_at: now.toISOString() })
    .eq("bot_id", botId)
    .eq("key", key)
    .like("value", `%${OPEN_MARK}%`)
    .select("key");
  if (upd.error) throw serverFailure(`[заметки оператора] задача не закрыта: ${upd.error.message}`);
  return { closed: (upd.data ?? []).length > 0 };
}

export type TodayTask = ClientTask & { botId: string; clientName: string; overdue: boolean };

/** «Задачи на сегодня» по всем клиентам: открытые со сроком не позже сегодняшнего дня платформы. */
export async function todayTasks(now = new Date()): Promise<{ today: string; tasks: TodayTask[] }> {
  const { day: today } = localDayHour(now, env().APP_TIMEZONE);
  const [all, tenants] = await Promise.all([rows(null, TASK_PREFIX, true), tenantDirectory(true)]);
  const names = new Map(tenants.map((t) => [t.id, t.name]));
  const parsed = all.flatMap((r) => {
    const t = r.bot_id ? parseTask(r.key, r.value) : null;
    return t && r.bot_id ? [{ ...t, botId: r.bot_id }] : [];
  });
  return {
    today,
    tasks: dueNow(parsed, today).map((t) => ({
      ...t,
      clientName: names.get(t.botId) ?? "клиент удалён",
      overdue: t.due < today,
    })),
  };
}
