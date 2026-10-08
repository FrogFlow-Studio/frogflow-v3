import { Link, useRouter } from "@tanstack/react-router";
import { Badge, Card, ErrorBox, Stat, useAction } from "@/app/ui";
import type { AdminKey, AdminT } from "@/app/i18n/admin";
import type { consultantTasksFn } from "./pricelist.functions";
import { markConsultantTaskFn } from "./pricelist.functions";
import type { consultantOverviewFn } from "./workspace.functions";
import { KNOWN_REASONS } from "./pricelist-cards";

/**
 * Общие куски рабочего места консультанта без продаж (BOVI): строка задачи
 * (на «Обзоре» и на «Задачах») и блок «Сегодня» на «Обзоре».
 */

export type WsTask = Awaited<ReturnType<typeof consultantTasksFn>>["tasks"][number];
export type WsOverview = Awaited<ReturnType<typeof consultantOverviewFn>>;

const CHANNEL_NAMES = { telegram: "Telegram", instagram: "Instagram", whatsapp: "WhatsApp" };

export function taskReason(t: AdminT, r: string): string {
  const key = `pricelist.tasks.reason.${r}` as AdminKey;
  return t(KNOWN_REASONS.includes(r) ? key : "pricelist.tasks.reason.other");
}

/** Чем закрыта задача — подпись под сделанной. */
export function taskVia(t: AdminT, task: Pick<WsTask, "doneVia">): string {
  return t(task.doneVia ? (`ws.tasks.via.${task.doneVia}` as AdminKey) : "ws.tasks.via.unknown");
}

/**
 * Куда ведёт «Открыть диалог»: в «Диалоги» панели, если модуль чата включён и
 * покупатель найден; иначе — наружу, по ссылке канала (ig.me, wa.me, t.me).
 */
export function taskDialog(
  task: Pick<WsTask, "telegramId" | "link">,
  chatOn: boolean,
): { inside: number } | { outside: string } | null {
  if (chatOn && task.telegramId != null) return { inside: task.telegramId };
  if (task.link) return { outside: task.link };
  return null;
}

export function TaskItem({
  task,
  t,
  date,
  chatOn,
  canEdit,
  busy,
  onMark,
}: {
  task: WsTask;
  t: AdminT;
  date: (iso: string) => string;
  chatOn: boolean;
  canEdit: boolean;
  busy: boolean;
  onMark: (id: string, done: boolean) => void;
}) {
  const where = taskDialog(task, chatOn);
  return (
    <li
      className={`rounded-md border border-line p-3 text-sm ${task.done ? "opacity-70" : ""}`}
      data-testid="ws-task"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{task.name ?? task.contact ?? task.userKey}</span>
        {task.channel && <Badge>{CHANNEL_NAMES[task.channel]}</Badge>}
        <Badge tone={task.done ? "neutral" : "warn"}>{taskReason(t, task.reason)}</Badge>
        <span className="text-xs text-muted">{date(task.at)}</span>
      </div>
      {task.contact && task.name && <div className="text-muted">{task.contact}</div>}
      {task.text && <p className="mt-1 whitespace-pre-wrap">{task.text}</p>}
      {task.products && task.products.length > 0 && (
        <p className="mt-1 text-xs text-muted">{task.products.join(" · ")}</p>
      )}
      {task.done && (
        <p className="mt-1 text-xs text-ok">
          {taskVia(t, task)}
          {task.doneAt ? ` · ${date(task.doneAt)}` : ""}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {where && "inside" in where && (
          <Link to="/admin/chat" search={{ c: where.inside }} className="btn-secondary text-xs">
            {t("ws.tasks.openDialog")}
          </Link>
        )}
        {where && "outside" in where && (
          <a
            className="btn-secondary text-xs"
            href={where.outside}
            target="_blank"
            rel="noreferrer"
          >
            {task.channel
              ? t("ws.tasks.openExternal", { channel: CHANNEL_NAMES[task.channel] })
              : t("ws.tasks.openDialog")}
          </a>
        )}
        {canEdit && (
          <button
            className={task.done ? "btn-ghost text-xs" : "btn-primary text-xs"}
            disabled={busy}
            onClick={() => onMark(task.id, !task.done)}
          >
            {task.done ? t("ws.tasks.undo") : t("ws.tasks.markDone")}
          </button>
        )}
      </div>
    </li>
  );
}

/** Подпись предупреждения «Что проверить». */
function alertText(
  t: AdminT,
  a: WsOverview["alerts"][number],
  date: (iso: string) => string,
): { title: string; text: string } {
  switch (a.key) {
    case "disabled":
      return { title: t("ws.alert.disabled.title"), text: t("ws.alert.disabled.text") };
    case "pricelistNone":
      return { title: t("ws.alert.pricelistNone.title"), text: t("ws.alert.pricelistNone.text") };
    case "pricelistStale":
      return {
        title: t("ws.alert.pricelistStale.title", { n: a.days }),
        text: t("ws.alert.pricelistStale.text"),
      };
    case "sheetFailing":
      return { title: t("ws.alert.sheetFailing.title"), text: t("ws.alert.sheetFailing.text") };
    case "rateNone":
      return { title: t("ws.alert.rateNone.title"), text: t("pricelist.rate.none") };
    case "rateStale":
      return { title: t("ws.alert.rateStale.title"), text: t("pricelist.rate.stale") };
    case "limitNear":
      return {
        title: t("ws.alert.limitNear.title"),
        text: t("ws.alert.limitNear.text", { usd: a.usd.toFixed(2), limit: a.limit.toFixed(2) }),
      };
    case "limitReached":
      return {
        title: t("ws.alert.limitReached.title"),
        text: t("ws.alert.limitReached.text", { limit: a.limit.toFixed(2) }),
      };
    case "modelFailing":
      return {
        title: t("ws.alert.modelFailing.title"),
        text: t("ws.alert.modelFailing.text", { date: date(a.at), error: a.error }),
      };
    case "chatOff":
      return { title: t("ws.alert.chatOff.title"), text: t("ws.alert.chatOff.text") };
    case "untaggedArticles":
      return { title: t("ws.alert.untagged.title", { n: a.n }), text: t("ws.alert.untagged.text") };
  }
}

const ALERT_ACTION: Record<string, AdminKey> = {
  "/admin/pricelist": "ws.alert.action.pricelist",
  "/admin/consultant": "ws.alert.action.settings",
  "/admin/modules": "ws.alert.action.modules",
  "/admin/knowledge": "ws.alert.action.knowledge",
};

/**
 * «Обзор» рабочего места: сегодня в цифрах, кто ждёт менеджера, что проверить,
 * передачи по дням. Данные — `consultantOverviewFn` (журнал ответов, задачи, прайс).
 */
export function WorkspaceOverview({
  data,
  t,
  loc,
  chatOn,
  canEditTasks,
  modulesLink,
}: {
  data: WsOverview;
  t: AdminT;
  loc: string;
  chatOn: boolean;
  canEditTasks: boolean;
  /** «Модули» видит только владелец и администратор: остальным — без кнопки. */
  modulesLink: boolean;
}) {
  const router = useRouter();
  const date = (iso: string) =>
    new Date(iso).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short" });
  const day = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(loc, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const mark = useAction(async (id: string, done: boolean) => {
    await markConsultantTaskFn({ data: { id, done } });
    await router.invalidate();
  });
  const yesterday = data.week.at(-2);
  // «Итого» считает сервер: диалоги за неделю — уникальные, а не сумма по дням.
  const total = data.weekTotal;
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return (
    <div className="mb-6 space-y-4" data-testid="ws-overview">
      <Card
        title={t("ws.today.title")}
        actions={
          <Badge tone={data.enabled ? "ok" : "warn"}>
            {data.enabled ? t("ws.today.on") : t("ws.today.off")}
          </Badge>
        }
      >
        <p className="mb-3 text-xs text-muted">
          {t("ws.today.subtitle", { date: day(data.today.date) })}
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label={t("ws.stat.dialogs")}
            value={data.today.dialogs}
            hint={yesterday ? t("ws.stat.dialogsHint", { n: yesterday.dialogs }) : undefined}
          />
          <Stat
            label={t("ws.stat.replies")}
            value={data.today.replies}
            hint={t("ws.stat.repliesHint", { n: data.today.silent })}
          />
          <Stat
            label={t("ws.stat.handoffs")}
            value={data.today.handoffs}
            hint={t("ws.stat.handoffsHint", { n: total.handoffs })}
          />
          <Stat
            label={t("ws.stat.spend")}
            value={`$${data.spend.usd.toFixed(2)}`}
            hint={t("ws.stat.spendHint", { limit: data.spend.limitUsd.toFixed(2) })}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {data.tasks && (
          <Card
            title={`${t("ws.waiting.title")} · ${data.tasks.open}`}
            actions={
              <Link to="/admin/tasks" className="btn-ghost text-xs">
                {t("ws.waiting.all")}
              </Link>
            }
          >
            {data.tasks.top.length === 0 ? (
              <p className="text-sm text-muted">{t("ws.waiting.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {data.tasks.top.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    t={t}
                    date={date}
                    chatOn={chatOn}
                    canEdit={canEditTasks}
                    busy={mark.busy}
                    onMark={(id, done) => void mark.run(id, done).catch(() => {})}
                  />
                ))}
              </ul>
            )}
            {data.tasks.open > data.tasks.top.length && (
              <p className="mt-2 text-xs text-muted">
                {t("ws.waiting.more", { n: data.tasks.open - data.tasks.top.length })}
              </p>
            )}
            <ErrorBox error={mark.error} />
          </Card>
        )}

        <Card title={t("ws.alerts.title")}>
          {data.alerts.length === 0 ? (
            <p className="text-sm text-muted">{t("ws.alerts.none")}</p>
          ) : (
            <ul className="space-y-2" data-testid="ws-alerts">
              {data.alerts.map((a) => {
                const { title, text } = alertText(t, a, date);
                const action =
                  a.to === "/admin/modules" && !modulesLink ? null : ALERT_ACTION[a.to];
                return (
                  <li key={a.key} className="rounded-md border border-warn/40 p-3 text-sm">
                    <div className="font-medium">{title}</div>
                    <p className="mt-0.5 text-muted">{text}</p>
                    {action && (
                      <Link to={a.to} className="mt-2 inline-block text-xs underline">
                        {t(action)}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t("ws.week.title")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="ws-week">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3 font-normal">{t("ws.week.date")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("ws.stat.dialogs")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("ws.week.replies")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("ws.week.handoffs")}</th>
                <th className="py-1 pr-3 text-right font-normal">{t("ws.week.silent")}</th>
                <th className="py-1 text-right font-normal">{t("ws.week.spend")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...data.week].reverse().map((d) => (
                <tr key={d.date} className="border-t border-line">
                  <td className="py-1 pr-3">{day(d.date)}</td>
                  <td className="py-1 pr-3 text-right">{d.dialogs}</td>
                  <td className="py-1 pr-3 text-right">{d.replies}</td>
                  <td className="py-1 pr-3 text-right">{d.handoffs}</td>
                  <td className="py-1 pr-3 text-right">{d.silent}</td>
                  <td className="py-1 text-right">{usd(d.usd)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-medium">
                <td className="py-1 pr-3">{t("ws.week.total")}</td>
                <td className="py-1 pr-3 text-right">{total.dialogs}</td>
                <td className="py-1 pr-3 text-right">{total.replies}</td>
                <td className="py-1 pr-3 text-right">{total.handoffs}</td>
                <td className="py-1 pr-3 text-right">{total.silent}</td>
                <td className="py-1 text-right">{usd(total.usd)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
