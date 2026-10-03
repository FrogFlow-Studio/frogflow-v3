import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { homeworkQueueFn, reviewHomeworkFn } from "@/app/admin/homework.functions";
import type { HomeworkRow } from "@/app/admin/homework.server";
import { Badge, Card, ErrorBox, PageTitle, useAction } from "@/app/ui";
import { adminT, intlLocale, type AdminT } from "@/app/i18n/admin";

/**
 * Домашние задания (ниша «Онлайн-школа»): очередь работ учеников, проверка
 * с отзывом. Работы на проверке — первыми, по давности сдачи.
 */
export const Route = createFileRoute("/admin/_authed/homework")({
  loader: () => homeworkQueueFn(),
  component: HomeworkPage,
});

function HomeworkPage() {
  const { items } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [tab, setTab] = useState<"waiting" | "all">("waiting");
  const canEdit = shop.role === "owner" || shop.role === "manager";
  const shown = tab === "waiting" ? items.filter((h) => h.status === "submitted") : items;
  const date = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(shop.locale), {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <>
      <PageTitle title={t("homework.title")} subtitle={t("homework.subtitle")} />
      <div className="mb-4 flex gap-2">
        {(["waiting", "all"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={tab === k ? "btn-primary text-sm" : "btn-secondary text-sm"}
            onClick={() => setTab(k)}
          >
            {t(`homework.tab.${k}`)}
            {k === "waiting" && (
              <span className="ml-1 tabular-nums">
                {items.filter((h) => h.status === "submitted").length}
              </span>
            )}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          {items.length === 0 ? t("homework.emptyAll") : t("homework.empty")}
        </p>
      ) : (
        <div className="space-y-4">
          {shown.map((h) => (
            <HomeworkCard
              key={`${h.orderItemId}_${h.lessonId}`}
              h={h}
              t={t}
              date={date}
              canEdit={canEdit}
              onDone={router.invalidate}
            />
          ))}
        </div>
      )}
    </>
  );
}

function HomeworkCard({
  h,
  t,
  date,
  canEdit,
  onDone,
}: {
  h: HomeworkRow;
  t: AdminT;
  date: (iso: string) => string;
  canEdit: boolean;
  onDone: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ notified: boolean } | null>(null);
  const review = useAction(async (status: "accepted" | "revise") => {
    const r = await reviewHomeworkFn({
      data: { orderItemId: h.orderItemId, lessonId: h.lessonId, rev: h.rev, status, text },
    });
    setResult({ notified: r.notified });
    await onDone();
  });
  const last = h.attempts.at(-1);
  const earlier = h.attempts.slice(0, -1);
  const tone = h.status === "accepted" ? "ok" : h.status === "revise" ? "warn" : "accent";
  return (
    <Card
      title={
        <span>
          {h.student} · {h.course}
        </span>
      }
      actions={<Badge tone={tone}>{t(`homework.status.${h.status}`)}</Badge>}
    >
      <p className="text-sm text-muted">
        {t("homework.lesson", { no: h.lessonNo, title: h.lessonTitle })}
      </p>
      {last && <Attempt a={last} t={t} date={date} />}
      {earlier.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted">
            {t("homework.earlier", { count: earlier.length })}
          </summary>
          {earlier.map((a) => (
            <Attempt key={a.at} a={a} t={t} date={date} />
          ))}
        </details>
      )}
      {h.feedback && (
        <div className="mt-3 rounded-md border border-line p-2 text-sm">
          <p className="text-xs text-muted">
            {t("homework.feedback")} · {date(h.feedback.at)}
          </p>
          <p className="whitespace-pre-line">{h.feedback.text}</p>
        </div>
      )}
      {result && (
        <p className={`mt-2 text-sm ${result.notified ? "text-ok" : "text-warn"}`}>
          {result.notified ? t("homework.notified") : t("homework.notNotified")}
        </p>
      )}
      {canEdit && h.status === "submitted" && (
        <div className="mt-3 space-y-2">
          <textarea
            className="input min-h-20"
            value={text}
            maxLength={4000}
            placeholder={t("homework.feedbackPlaceholder")}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={review.busy}
              onClick={() => void review.run("accepted").catch(() => {})}
            >
              {t("homework.accept")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={review.busy}
              onClick={() => void review.run("revise").catch(() => {})}
            >
              {t("homework.revise")}
            </button>
          </div>
          <ErrorBox error={review.error} />
        </div>
      )}
    </Card>
  );
}

function Attempt({
  a,
  t,
  date,
}: {
  a: HomeworkRow["attempts"][number];
  t: AdminT;
  date: (iso: string) => string;
}) {
  return (
    <div className="mt-2 space-y-2 text-sm">
      <p className="text-xs text-muted">{t("homework.attempt", { date: date(a.at) })}</p>
      {a.text && <p className="whitespace-pre-line">{a.text}</p>}
      {a.files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {a.files.map((f) =>
            f.media === "audio" ? (
              <audio key={f.url} src={f.url} controls preload="none" className="h-10 max-w-full" />
            ) : f.media === "video" ? (
              <video
                key={f.url}
                src={f.url}
                controls
                preload="metadata"
                className="max-h-64 max-w-full rounded-md border border-line"
              />
            ) : f.image ? (
              <a key={f.url} href={f.url} target="_blank" rel="noreferrer">
                <img
                  src={f.url}
                  alt={f.name}
                  className="h-32 w-32 rounded-md border border-line object-cover"
                />
              </a>
            ) : (
              <a
                key={f.url}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                📎 {f.name}
              </a>
            ),
          )}
        </div>
      )}
    </div>
  );
}
