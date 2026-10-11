import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  automationLogsFn,
  deleteAutomationFn,
  toggleAutomationFn,
} from "@/app/admin/instagram.functions";
import { type AdminT } from "@/app/i18n/admin";
import { HelpTip } from "@/app/admin/help-panel";
import { Badge, Card, Empty, ErrorBox, Switch, useAction } from "@/app/ui";
import { type Automation, type Data, ruleAnchor, useAdminI18n } from "./shared";

/** Список правил автоответов и журнал срабатываний. */

function targetLabel(t: AdminT, a: Automation): string {
  if (a.trigger === "story_reply") return t("instagram.target.storyReplies");
  if (!a.platformPostId) return t("instagram.target.allPosts");
  return a.postTitle
    ? t("instagram.target.postTitled", { title: a.postTitle.slice(0, 40) })
    : t("instagram.target.postId", { id: a.platformPostId });
}

export function RulesCard({
  data,
  highlight,
  onNew,
  onEdit,
  onCopy,
}: {
  data: Data;
  /** Только что сохранённое правило — подсвечивается на пару секунд. */
  highlight: string | null;
  onNew: () => void;
  onEdit: (a: Automation) => void;
  onCopy: (a: Automation) => void;
}) {
  const router = useRouter();
  const { t } = useAdminI18n();
  const toggle = useAction(async (a: Automation) => {
    await toggleAutomationFn({ data: { id: a.id, isActive: !a.isActive } });
    await router.invalidate();
  });
  const remove = useAction(async (a: Automation) => {
    if (!confirm(t("instagram.rules.deleteConfirm", { name: a.name }))) return;
    await deleteAutomationFn({ data: { id: a.id } });
    await router.invalidate();
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("instagram.rules.title")}
          <HelpTip article="instagram" anchor="rules" />
        </span>
      }
      actions={
        <button className="btn-primary text-xs" onClick={onNew}>
          {t("instagram.rules.new")}
        </button>
      }
    >
      {data.automationsError ? (
        <p className="text-sm text-danger">
          {t(data.automationsError.key as never) || data.automationsError.message}
        </p>
      ) : data.automations.length === 0 ? (
        <Empty>{t("instagram.rules.empty")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {data.automations.map((a) => (
            <li
              key={a.id}
              id={ruleAnchor(a.id)}
              data-highlighted={highlight === a.id ? "true" : undefined}
              className={`-mx-2 scroll-mt-4 rounded-md px-2 py-3 transition-colors duration-700 ${
                highlight === a.id ? "bg-accent/10" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.name}</span>
                    <Badge tone={a.isActive ? "ok" : "neutral"}>
                      {a.isActive ? t("instagram.rules.active") : t("instagram.rules.inactive")}
                    </Badge>
                    {a.twoStepDm && (
                      <Badge tone="accent">{t("instagram.rules.twoStepBadge")}</Badge>
                    )}
                    {data.accounts.length > 1 && (
                      <span className="text-xs text-muted">
                        {data.accounts.find((x) => x.id === a.accountId)?.name ?? a.accountId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {targetLabel(t, a)} ·{" "}
                    {a.keywords.length
                      ? `${a.matchMode === "exact" ? t("instagram.match.exact") : t("instagram.match.contains")}: ${a.keywords.join(", ")}`
                      : t("instagram.rules.anyComment")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm">{a.dmMessage}</p>
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    {t("instagram.rules.stats", {
                      triggered: a.stats.triggered,
                      sent: a.stats.dmsSent,
                    })}
                    {a.stats.dmsFailed > 0 && (
                      <span className="text-danger">
                        {" "}
                        {t("instagram.rules.failedCount", { n: a.stats.dmsFailed })}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={a.isActive}
                      onChange={() => void toggle.run(a).catch(() => {})}
                      label={t("instagram.rules.enabled")}
                    />
                    <HelpTip article="instagram" anchor="enabled" />
                  </div>
                  <button className="btn-ghost text-xs" onClick={() => onEdit(a)}>
                    {t("common.edit")}
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => onCopy(a)}>
                    {t("instagram.rules.copy")}
                  </button>
                  <button
                    className="btn-ghost text-xs text-danger"
                    onClick={() => void remove.run(a).catch(() => {})}
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>
              <LogsDisclosure id={a.id} />
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={toggle.error ?? remove.error} />
    </Card>
  );
}

function LogsDisclosure({ id }: { id: string }) {
  const { t, intl } = useAdminI18n();
  const [open, setOpen] = useState(false);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof automationLogsFn>>["logs"] | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLogs(null);
    automationLogsFn({ data: { id, onlyFailed } })
      .then((r) => {
        if (!cancelled) setLogs(r.logs);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onlyFailed, id]);
  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5">
        <button className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
          {open ? t("instagram.logs.hide") : t("instagram.logs.show")}
        </button>
        <HelpTip article="instagram" anchor="history" />
      </div>
      {open && (
        <div className="mt-2 rounded-md border border-line p-2 text-xs">
          <label className="mb-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyFailed}
              onChange={(e) => setOnlyFailed(e.target.checked)}
            />
            {t("instagram.logs.onlyFailed")}
            <HelpTip article="instagram" anchor="history" />
          </label>
          <ErrorBox error={error} />
          {logs === null ? (
            <p className="text-muted">{t("instagram.loading")}</p>
          ) : logs.length === 0 ? (
            <p className="text-muted">{t("instagram.logs.empty")}</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-auto">
              {logs.map((l, i) => (
                <li key={`${l.commentId}-${i}`} className="flex flex-wrap gap-2">
                  <Badge
                    tone={l.status === "sent" ? "ok" : l.status === "failed" ? "danger" : "neutral"}
                  >
                    {l.status || "?"}
                  </Badge>
                  {l.username && <span>@{l.username}</span>}
                  <span className="truncate text-muted">{l.commentText}</span>
                  {l.error && <span className="text-danger">{l.error}</span>}
                  {l.createdAt && (
                    <span className="text-muted">{new Date(l.createdAt).toLocaleString(intl)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
