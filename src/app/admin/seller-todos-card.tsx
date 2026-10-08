import { useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ErrorBox, useAction } from "@/app/ui";
import type { AdminT } from "@/app/i18n/admin";
import {
  addSellerTodoFn,
  markSellerTodoFn,
  removeSellerTodoFn,
  type sellerTodosFn,
} from "@/app/admin/todos.functions";

export type SellerTodosData = Awaited<ReturnType<typeof sellerTodosFn>>;
type Todo = SellerTodosData["later"][number];

/** «12 окт.» по языку админки; день хранится как «ГГГГ-ММ-ДД». */
function dayLabel(day: string, loc: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(loc, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/**
 * Свои задачи продавца внутри «Что сделать сегодня»: поле «Добавить задачу…»
 * с выбором дня, галочки, удаление, «Позже» и «Сделано (N)» свёрнутыми.
 */
export function SellerTodos({
  data,
  t,
  loc,
  canEdit,
}: {
  data: SellerTodosData;
  t: AdminT;
  loc: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [day, setDay] = useState(data.today);
  // Один id на черновик: повтор после сбоя сети не задвоит задачу.
  const draftId = useRef<string | null>(null);
  const add = useAction(async () => {
    const clean = text.trim();
    if (!clean) return;
    draftId.current ??= newId();
    await addSellerTodoFn({
      data: { id: draftId.current, text: clean, day: day < data.today ? data.today : day },
    });
    draftId.current = null;
    setText("");
    setDay(data.today);
    await router.invalidate();
  });
  const mark = useAction(async (id: string, done: boolean) => {
    await markSellerTodoFn({ data: { id, done } });
    await router.invalidate();
  });
  const remove = useAction(async (id: string) => {
    await removeSellerTodoFn({ data: { id } });
    await router.invalidate();
  });
  const busy = add.busy || mark.busy || remove.busy;

  const author = (by: string | undefined) =>
    by && by !== data.me ? <span className="text-xs text-muted">· {by}</span> : null;

  const row = (todo: Todo & { carried?: boolean }, note?: string) => (
    <li key={todo.id} className="flex items-start gap-3 py-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={todo.done}
        disabled={!canEdit || busy}
        aria-label={todo.done ? t("todos.undo") : t("todos.done")}
        onChange={(e) => void mark.run(todo.id, e.target.checked).catch(() => {})}
      />
      <span className="min-w-0 flex-1 break-words">
        <span className={todo.done ? "text-muted line-through" : ""}>{todo.text}</span>{" "}
        {note && <span className="text-xs text-muted">· {note}</span>} {author(todo.by)}
        {todo.done && todo.doneBy && todo.doneBy !== todo.by && todo.doneBy !== data.me && (
          <span className="text-xs text-muted"> · {t("todos.doneBy", { name: todo.doneBy })}</span>
        )}
      </span>
      {canEdit && (
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy}
          aria-label={t("todos.remove")}
          title={t("todos.remove")}
          onClick={() => void remove.run(todo.id).catch(() => {})}
        >
          ✕
        </button>
      )}
    </li>
  );

  return (
    <div className="mt-3 border-t border-line pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        {t("todos.mine")}
      </h3>
      {data.due.length > 0 && (
        <ul className="divide-y divide-line">
          {data.due.map((todo) =>
            row(
              todo,
              todo.carried ? t("todos.carried", { date: dayLabel(todo.day, loc) }) : undefined,
            ),
          )}
        </ul>
      )}
      {canEdit && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add.run().catch(() => {});
          }}
        >
          <input
            className="input min-w-0 flex-1"
            value={text}
            maxLength={300}
            placeholder={t("todos.placeholder")}
            aria-label={t("todos.placeholder")}
            onChange={(e) => {
              setText(e.target.value);
              draftId.current = null;
            }}
          />
          <input
            type="date"
            className="input w-auto"
            value={day}
            min={data.today}
            aria-label={t("todos.day")}
            onChange={(e) => setDay(e.target.value || data.today)}
          />
          <button type="submit" className="btn-secondary text-sm" disabled={busy || !text.trim()}>
            {t("todos.add")}
          </button>
        </form>
      )}
      <ErrorBox error={add.error ?? mark.error ?? remove.error} />
      {data.later.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">
            {t("todos.later", { n: data.later.length })}
          </summary>
          <ul className="divide-y divide-line">
            {data.later.map((todo) =>
              row(todo, t("todos.onDay", { date: dayLabel(todo.day, loc) })),
            )}
          </ul>
        </details>
      )}
      {data.done.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted">
            {t("todos.doneList", { n: data.done.length })}
          </summary>
          <ul className="divide-y divide-line">{data.done.map((todo) => row(todo))}</ul>
          <p className="mt-1 text-xs text-muted">{t("todos.doneKeep")}</p>
        </details>
      )}
    </div>
  );
}
