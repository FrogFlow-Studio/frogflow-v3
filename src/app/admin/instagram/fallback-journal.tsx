import { HelpTip } from "@/app/admin/help-panel";
import { Badge, Card } from "@/app/ui";
import { type Data, useAdminI18n } from "./shared";

/** Журнал комментариев без правила. */

export function FallbackJournal({ rows }: { rows: Data["fallbackSends"] }) {
  const { t, intl } = useAdminI18n();
  if (rows.length === 0) return null;
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          {t("instagram.fallback.title")}
          <HelpTip article="instagram" anchor="fallback-journal" />
        </span>
      }
    >
      <p className="mb-2 text-xs text-muted">{t("instagram.fallback.intro")}</p>
      <ul className="divide-y divide-line text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <Badge tone={r.status === "sent" ? "ok" : r.status === "failed" ? "danger" : "warn"}>
              {r.status}
            </Badge>
            <span className="text-muted">{new Date(r.created_at).toLocaleString(intl)}</span>
            <span>{t("instagram.fallback.comment", { id: r.comment_id })}</span>
            {r.alt_channel_status === "sent" && (
              <span className="text-ok">{t("instagram.fallback.viaDialog")}</span>
            )}
            {r.comment_reply_status === "sent" && (
              <span>{t("instagram.fallback.publicReply")}</span>
            )}
            {r.comment_reply_error === "prompt_sent" && (
              <span>{t("instagram.fallback.promptSent")}</span>
            )}
            {r.error && <span className="text-danger">{r.error.slice(0, 160)}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
