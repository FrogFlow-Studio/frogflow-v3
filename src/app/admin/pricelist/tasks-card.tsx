import { useEffect, useState } from "react";
import {
  clearConsultantTasksFn,
  consultantTasksFn,
  markConsultantTaskFn,
} from "../pricelist.functions";
import { Badge, Card, ErrorBox, useAction } from "@/app/ui";
import { type AdminKey } from "@/app/i18n/admin";
import { type CardProps } from "./shared";
import { HelpTip } from "@/app/admin/help-panel";

/** Задачи консультанта для менеджера. */

/**
 * Задачи консультанта: каждая передача менеджеру. Список читается отдельным
 * вызовом — в нём имена и телефоны покупателей, и роли «просмотр» он закрыт.
 */
export function TasksCard({
  t,
  canEdit,
  date,
}: Omit<CardProps, "onDone"> & { date: (s: string) => string }) {
  type Tasks = Awaited<ReturnType<typeof consultantTasksFn>>;
  const [list, setList] = useState<Tasks | null>(null);
  const load = useAction(async () => setList(await consultantTasksFn()));
  useEffect(() => {
    if (canEdit) void load.run().catch(() => {});
    // Один раз при открытии страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);
  const mark = useAction(async (id: string, done: boolean) => {
    await markConsultantTaskFn({ data: { id, done } });
    await load.run();
  });
  const [confirmAll, setConfirmAll] = useState(false);
  const clear = useAction(async (which: "done" | "all") => {
    await clearConsultantTasksFn({ data: { which } });
    setConfirmAll(false);
    await load.run();
  });
  if (!canEdit) return null;
  const reason = (r: string) => {
    const key = `pricelist.tasks.reason.${r}` as AdminKey;
    return t(KNOWN_REASONS.includes(r) ? key : "pricelist.tasks.reason.other");
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("pricelist.tasks.title")}
          <HelpTip article="pricelist" anchor="tasks" />
        </span>
      }
    >
      <p className="mb-3 text-sm text-muted">{t("pricelist.tasks.hint")}</p>
      {list && list.tasks.length === 0 && <p className="text-sm">{t("pricelist.tasks.empty")}</p>}
      {list && list.tasks.length > 0 && (
        <>
          <p className="mb-2 text-sm">{t("pricelist.tasks.open", { count: list.open })}</p>
          <ul className="space-y-2">
            {list.tasks.map((task) => (
              <li
                key={task.id}
                className={`rounded-md border border-line p-3 text-sm ${task.done ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={task.done ? "neutral" : "accent"}>{reason(task.reason)}</Badge>
                  {task.channel && (
                    <span className="text-xs text-muted">
                      {t(`pricelist.tasks.channel.${task.channel}` as AdminKey)}
                    </span>
                  )}
                  <span className="text-xs text-muted">{date(task.at)}</span>
                </div>
                <div className="mt-1 font-medium">{task.name ?? task.userKey}</div>
                {task.contact && <div className="text-muted">{task.contact}</div>}
                {task.text && <p className="mt-1 whitespace-pre-wrap">{task.text}</p>}
                {task.products && task.products.length > 0 && (
                  <>
                    <div className="mt-1 text-xs text-muted">{t("pricelist.tasks.products")}</div>
                    <ul className="list-disc pl-5 text-xs">
                      {task.products.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {task.link && (
                    <a
                      className="btn-ghost text-xs"
                      href={task.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("pricelist.tasks.openDialog")}
                    </a>
                  )}
                  <button
                    className="btn-secondary text-xs"
                    disabled={mark.busy}
                    onClick={() => void mark.run(task.id, !task.done).catch(() => {})}
                  >
                    {task.done ? t("pricelist.tasks.undo") : t("pricelist.tasks.done")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              disabled={clear.busy}
              onClick={() => void clear.run("done").catch(() => {})}
            >
              {t("pricelist.tasks.clearDone")}
            </button>
            {confirmAll ? (
              <span className="flex flex-wrap items-center gap-3 text-sm">
                <span>{t("ws.tasks.clearAllConfirm")}</span>
                <button
                  className="btn-danger text-sm"
                  disabled={clear.busy}
                  onClick={() => void clear.run("all").catch(() => {})}
                >
                  {t("pricelist.tasks.clearAll")}
                </button>
                <button className="btn-ghost text-sm" onClick={() => setConfirmAll(false)}>
                  {t("common.cancel")}
                </button>
              </span>
            ) : (
              <button className="btn-ghost text-danger" onClick={() => setConfirmAll(true)}>
                {t("pricelist.tasks.clearAll")}
              </button>
            )}
          </div>
        </>
      )}
      <ErrorBox error={load.error ?? mark.error ?? clear.error} />
    </Card>
  );
}

/** Причины передачи, у которых есть своя подпись; остальное — «передача менеджеру». */
export const KNOWN_REASONS = [
  "purchase",
  "wholesale",
  "complaint",
  "human_requested",
  "photo",
  "unknown_question",
];
