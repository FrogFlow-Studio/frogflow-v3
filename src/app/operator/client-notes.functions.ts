import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Серверные функции панели оператора: заметки и задачи по клиентам.
 * Каждая начинается с requireOperator():
 * маршрутный гейт — только UX, функции вызываются по HTTP напрямую.
 * Реализация — в серверных модулях *.server.ts (не попадают в бандл).
 */
const guard = async () => (await import("@/app/auth/guards.server")).requireOperator();

const botId = z.string().uuid();

const notesImpl = () => import("./client-notes.server");

export const clientNotesFn = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ botId }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await notesImpl()).listClientNotes(data.botId);
  });

export const addClientNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, text: z.string().max(4000) }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await notesImpl()).addClientNote(data.botId, data.text);
    return { ok: true as const };
  });

export const deleteClientNoteFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    await (await notesImpl()).deleteClientNote(data.botId, data.id);
    return { ok: true as const };
  });

export const addClientTaskFn = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ botId, text: z.string().max(500), due: z.string().max(10) }).parse(d),
  )
  .handler(async ({ data }) => {
    await guard();
    await (await notesImpl()).addClientTask(data.botId, data.text, data.due);
    return { ok: true as const };
  });

export const closeClientTaskFn = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ botId, id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await guard();
    return (await notesImpl()).closeClientTask(data.botId, data.id);
  });

export const todayTasksFn = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  return (await notesImpl()).todayTasks();
});
