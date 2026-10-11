import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  clearConsultantTasksFn,
  consultantTasksFn,
  markConsultantTaskFn,
} from "@/app/admin/pricelist.functions";
import { TaskItem } from "@/app/admin/workspace-ui";
import { Empty, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminKey } from "@/app/i18n/admin";
import { CONTACTS_MIN_ROLE, canEdit, roleAllows } from "@/core/auth/roles";
import { HelpTip } from "@/app/admin/help-panel";

/**
 * «Задачи» рабочего места консультанта (BOVI): покупатели, которых консультант
 * передал менеджеру. Задача закрывается сама, когда менеджер ответил
 * покупателю (core/consultant/tasks closeTaskAfterReply), или кнопкой.
 * Видна тому, кто видит контакты покупателей (не ниже менеджера), и только
 * консультанту по прайсу; остальным — «Обзор».
 */
const CHANNELS = ["telegram", "instagram", "whatsapp"] as const;

export const Route = createFileRoute("/admin/_authed/tasks")({
  validateSearch: z.object({
    tab: z.enum(["open", "done"]).optional(),
    ch: z.enum(CHANNELS).optional(),
  }),
  beforeLoad: ({ context }) => {
    if (!context.shop.pricelist || !roleAllows(context.shop.role, CONTACTS_MIN_ROLE))
      throw redirect({ to: "/admin" });
  },
  loader: () => consultantTasksFn(),
  component: TasksPage,
});

function TasksPage() {
  const data = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const { tab = "open", ch } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const t = adminT(shop.locale);
  const loc = intlLocale(shop.locale);
  const date = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });
  const editable = canEdit(shop.role);
  const [confirm, setConfirm] = useState<"done" | "all" | null>(null);
  const mark = useAction(async (id: string, done: boolean) => {
    await markConsultantTaskFn({ data: { id, done } });
    await router.invalidate();
  });
  const clear = useAction(async (which: "done" | "all") => {
    await clearConsultantTasksFn({ data: { which } });
    setConfirm(null);
    await router.invalidate();
  });
  const byChannel = data.tasks.filter((x) => !ch || x.channel === ch);
  const open = byChannel.filter((x) => !x.done);
  const done = byChannel.filter((x) => x.done);
  const list = tab === "open" ? open : done;
  const tabClass = (on: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-line"}`;
  return (
    <>
      <PageTitle title={t("ws.tasks.title")} subtitle={t("ws.tasks.subtitle")} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t("ws.tasks.tabs")} className="flex gap-2">
          <button
            role="tab"
            aria-selected={tab === "open"}
            className={tabClass(tab === "open")}
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, tab: "open" }), replace: true })
            }
          >
            {t("ws.tasks.open", { n: open.length })}
          </button>
          <button
            role="tab"
            aria-selected={tab === "done"}
            className={tabClass(tab === "done")}
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, tab: "done" }), replace: true })
            }
          >
            {t("ws.tasks.done", { n: done.length })}
          </button>
        </div>
        <select
          className="input ml-auto w-auto"
          aria-label={t("ws.tasks.channel")}
          value={ch ?? ""}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                ch: (e.target.value || undefined) as (typeof CHANNELS)[number] | undefined,
              }),
              replace: true,
            })
          }
        >
          <option value="">{t("ws.tasks.channelAll")}</option>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t(`pricelist.tasks.channel.${c}` as AdminKey)}
            </option>
          ))}
        </select>
        <HelpTip article="tasks" anchor="filter" />
      </div>

      {list.length === 0 ? (
        <Empty>{tab === "open" ? t("ws.tasks.emptyOpen") : t("ws.tasks.emptyDone")}</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              t={t}
              date={date}
              chatOn={Boolean(shop.modules.manager_chat)}
              canEdit={editable}
              busy={mark.busy}
              onMark={(id, d) => void mark.run(id, d).catch(() => {})}
            />
          ))}
        </ul>
      )}
      <ErrorBox error={mark.error ?? clear.error} />

      {editable && data.tasks.length > 0 && (
        <div className="mt-6 space-y-2 border-t border-line pt-4">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/15 p-3 text-sm">
              <span className="min-w-0 flex-1">
                {confirm === "done"
                  ? t("ws.tasks.clearDoneConfirm")
                  : t("ws.tasks.clearAllConfirm")}
              </span>
              <button
                className={confirm === "all" ? "btn-danger text-sm" : "btn-primary text-sm"}
                disabled={clear.busy}
                onClick={() => void clear.run(confirm).catch(() => {})}
              >
                {confirm === "done" ? t("ws.tasks.clearDone") : t("ws.tasks.clearAll")}
              </button>
              <button className="btn-ghost text-sm" onClick={() => setConfirm(null)}>
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button
                className="btn-secondary text-sm"
                disabled={!data.tasks.some((x) => x.done)}
                onClick={() => setConfirm("done")}
              >
                {t("ws.tasks.clearDone")}
              </button>
              <button className="btn-ghost text-sm text-danger" onClick={() => setConfirm("all")}>
                {t("ws.tasks.clearAll")}
              </button>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {t("ws.tasks.limit")}
            <HelpTip article="tasks" anchor="cleanup" />
          </p>
        </div>
      )}
    </>
  );
}
