/** Заметки и задачи оператора по клиенту; «задачи на сегодня» — блок на главной оператора. */
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  addClientNoteFn,
  addClientTaskFn,
  clientNotesFn,
  closeClientTaskFn,
  deleteClientNoteFn,
  todayTasksFn,
} from "@/app/operator/operator.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import type { C } from "./types";

type Notes = Awaited<ReturnType<typeof clientNotesFn>>;

export function NotesCard({ c }: { c: C }) {
  const [data, setData] = useState<Notes | null>(null);
  const [note, setNote] = useState("");
  const [task, setTask] = useState("");
  const [due, setDue] = useState("");
  const load = useAction(async () => setData(await clientNotesFn({ data: { botId: c.id } })));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);
  const addNote = useAction(async () => {
    await addClientNoteFn({ data: { botId: c.id, text: note } });
    setNote("");
    await load.run();
  });
  const delNote = useAction(async (id: string) => {
    await deleteClientNoteFn({ data: { botId: c.id, id } });
    await load.run();
  });
  const addTask = useAction(async () => {
    await addClientTaskFn({ data: { botId: c.id, text: task, due } });
    setTask("");
    await load.run();
  });
  const closeTask = useAction(async (id: string) => {
    await closeClientTaskFn({ data: { botId: c.id, id } });
    await load.run();
  });
  const submit = (fn: () => Promise<unknown>) => (e: FormEvent) => {
    e.preventDefault();
    void fn().catch(() => {});
  };
  return (
    <Card title="Заметки и задачи">
      <ErrorBox
        error={load.error ?? addNote.error ?? delNote.error ?? addTask.error ?? closeTask.error}
      />
      <h3 className="text-sm font-medium">Задачи</h3>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={submit(addTask.run)}>
        <input
          className="input min-w-0 flex-1"
          aria-label="Задача"
          placeholder="Позвонить, уточнить оплату…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          maxLength={500}
        />
        <input
          className="input"
          type="date"
          aria-label="Срок задачи"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <button className="btn-primary" disabled={addTask.busy || !task.trim() || !due}>
          Добавить задачу
        </button>
      </form>
      <ul className="mt-3 space-y-2">
        {(data?.tasks ?? []).map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
            <span className={t.status === "done" ? "text-muted line-through" : ""}>
              <span className="text-muted">{t.due}</span> {t.text}
            </span>
            {t.status === "open" ? (
              <button
                className="btn-ghost"
                disabled={closeTask.busy}
                onClick={() => void closeTask.run(t.id).catch(() => {})}
              >
                Закрыть
              </button>
            ) : (
              <Badge tone="ok">закрыта</Badge>
            )}
          </li>
        ))}
        {data && data.tasks.length === 0 && <li className="text-sm text-muted">Задач нет.</li>}
      </ul>
      <h3 className="mt-5 text-sm font-medium">Заметки</h3>
      <form className="mt-2 space-y-2" onSubmit={submit(addNote.run)}>
        <textarea
          className="input w-full"
          rows={3}
          aria-label="Заметка"
          placeholder="О чём договорились, что просил клиент"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={4000}
        />
        <button className="btn-secondary" disabled={addNote.busy || !note.trim()}>
          Сохранить заметку
        </button>
      </form>
      <ul className="mt-3 space-y-3">
        {(data?.notes ?? []).map((n) => (
          <li key={n.id} className="text-sm">
            <div className="flex justify-between gap-2 text-xs text-muted">
              <span>{n.at ? new Date(n.at).toLocaleString("ru") : ""}</span>
              <button
                className="text-danger"
                onClick={() => void delNote.run(n.id).catch(() => {})}
              >
                Удалить
              </button>
            </div>
            <p className="whitespace-pre-wrap">{n.text}</p>
          </li>
        ))}
        {data && data.notes.length === 0 && <li className="text-sm text-muted">Заметок нет.</li>}
      </ul>
    </Card>
  );
}

type Today = Awaited<ReturnType<typeof todayTasksFn>>;

/** «Задачи на сегодня» на главной: открытые, срок сегодня или раньше; пусто — блока нет. */
export function TodayTasks() {
  const [data, setData] = useState<Today | null>(null);
  const load = useAction(async () => setData(await todayTasksFn()));
  useEffect(() => {
    void load.run().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = useAction(async (botId: string, id: string) => {
    await closeClientTaskFn({ data: { botId, id } });
    await load.run();
  });
  if (load.error) return <ErrorBox error={load.error} />;
  if (!data || data.tasks.length === 0) return null;
  return (
    <div className="mb-6">
      <Card title={`Задачи на сегодня (${data.tasks.length})`}>
        <ErrorBox error={close.error} />
        <ul className="space-y-2">
          {data.tasks.map((t) => (
            <li
              key={`${t.botId}:${t.id}`}
              className="flex items-start justify-between gap-2 text-sm"
            >
              <span>
                <Link
                  to="/operator/clients/$botId"
                  params={{ botId: t.botId }}
                  className="font-medium"
                >
                  {t.clientName}
                </Link>
                : {t.text} {t.overdue ? <Badge tone="danger">просрочено · {t.due}</Badge> : null}
              </span>
              <button
                className="btn-ghost"
                disabled={close.busy}
                onClick={() => void close.run(t.botId, t.id).catch(() => {})}
              >
                Закрыть
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
