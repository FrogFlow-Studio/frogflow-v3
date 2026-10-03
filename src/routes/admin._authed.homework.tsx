import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  homeworkQueueFn,
  reviewHomeworkFn,
  saveCuratorsFn,
  saveHwRepliesFn,
} from "@/app/admin/homework.functions";
import {
  fillHwReply,
  HW_REPLIES_MAX,
  HW_REPLY_TEXT_MAX,
  HW_REPLY_TITLE_MAX,
} from "@/core/courses/hw-replies";
import type { HomeworkReply } from "@/core/tenant/types";
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
  const { items: all, curators, cohorts, load, replies } = Route.useLoaderData();
  const { shop } = Route.useRouteContext();
  const t = adminT(shop.locale);
  const router = useRouter();
  const [tab, setTab] = useState<"waiting" | "all">("waiting");
  const canEdit = shop.role === "owner" || shop.role === "manager";
  const [mine, setMine] = useState(false);
  // «Мои» — работы, закреплённые за куратором с логином текущего пользователя.
  const items = mine ? all.filter((h) => h.curator?.username === shop.username) : all;
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
      {canEdit && (
        <CuratorsCard curators={curators} cohorts={cohorts} load={load} date={date} t={t} />
      )}
      {canEdit && <RepliesCard replies={replies} t={t} />}
      <div className="mb-4 flex flex-wrap gap-2">
        {curators.items.length > 0 && (
          <button
            type="button"
            className={mine ? "btn-primary text-sm" : "btn-secondary text-sm"}
            onClick={() => setMine(!mine)}
          >
            {t("homework.mine")}
          </button>
        )}
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
              replies={replies}
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
  replies,
  onDone,
}: {
  h: HomeworkRow;
  t: AdminT;
  date: (iso: string) => string;
  canEdit: boolean;
  replies: HomeworkReply[];
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
        {h.curator && ` · ${t("homework.curatorOf", { name: h.curator.name })}`}
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
          {replies.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted">{t("homework.replyInsert")}</span>
              {replies.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  className="btn-ghost border border-line text-xs"
                  title={r.text}
                  onClick={() =>
                    setText((cur) =>
                      [cur.trim(), fillHwReply(r.text, h.student)].filter(Boolean).join("\n\n"),
                    )
                  }
                >
                  {r.title}
                </button>
              ))}
            </div>
          )}
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

type CuratorsData = Awaited<ReturnType<typeof homeworkQueueFn>>;
type CuratorRow = {
  id?: string;
  name: string;
  telegram: string;
  username: string;
  cohorts: string[];
};

/** Кураторы школы: список, режим назначения; сохраняется отдельной кнопкой. */
function CuratorsCard({
  curators,
  cohorts,
  load,
  date,
  t,
}: {
  curators: CuratorsData["curators"];
  cohorts: CuratorsData["cohorts"];
  load: CuratorsData["load"];
  date: (iso: string) => string;
  t: AdminT;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(curators.mode);
  const [rows, setRows] = useState<CuratorRow[]>(
    curators.items.map((c) => ({
      id: c.id,
      name: c.name,
      telegram: String(c.telegram_id),
      username: c.username ?? "",
      cohorts: c.cohorts ?? [],
    })),
  );
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<CuratorRow>) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const save = useAction(async () => {
    await saveCuratorsFn({
      data: {
        mode,
        items: rows.map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name,
          telegramId: Number(r.telegram),
          username: r.username,
          cohorts: r.cohorts,
        })),
      },
    });
    setSaved(true);
    await router.invalidate();
  });
  const valid = rows.every((r) => r.name.trim() && /^\d{1,15}$/.test(r.telegram.trim()));
  return (
    <details className="mb-4 rounded-md border border-line p-3 text-sm" open={rows.length > 0}>
      <summary className="cursor-pointer font-medium">
        {t("homework.curators")} · {rows.length}
      </summary>
      <p className="mt-2 text-xs text-muted">{t("homework.curatorsHint")}</p>
      {load.length > 0 && (
        <div className="mt-3 rounded-md border border-line p-2 text-xs">
          <p className="mb-1 font-medium">{t("homework.load.title")}</p>
          <ul className="divide-y divide-line">
            {load.map((l) => (
              <li key={l.id ?? "none"} className="flex flex-wrap gap-x-3 gap-y-0.5 py-1">
                <span className="font-medium">{l.name || t("homework.load.none")}</span>
                <span>{t("homework.load.waiting", { n: l.waiting })}</span>
                <span className="text-muted">
                  {t("homework.load.reviewed", { n: l.reviewed7d })}
                </span>
                {l.oldest && (
                  <span className="text-muted">
                    {t("homework.load.oldest", {
                      student: l.oldest.student,
                      course: l.oldest.course,
                      no: l.oldest.lessonNo,
                      date: date(l.oldest.at),
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {t("homework.curatorsMode")}
        <select
          className="input w-auto text-xs"
          value={mode}
          onChange={(e) => {
            setSaved(false);
            setMode(e.target.value as "rotate" | "cohort");
          }}
        >
          <option value="rotate">{t("homework.curatorsRotate")}</option>
          <option value="cohort">{t("homework.curatorsCohort")}</option>
        </select>
      </label>
      <div className="mt-3 space-y-3">
        {rows.map((r, i) => (
          <div key={r.id ?? i} className="space-y-2 rounded-md border border-line p-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                className="input"
                aria-label={t("homework.curatorName")}
                placeholder={t("homework.curatorName")}
                maxLength={60}
                value={r.name}
                onChange={(e) => set(i, { name: e.target.value })}
              />
              <input
                className="input"
                inputMode="numeric"
                aria-label={t("homework.curatorTelegram")}
                placeholder={t("homework.curatorTelegram")}
                value={r.telegram}
                onChange={(e) => set(i, { telegram: e.target.value.trim() })}
              />
              <input
                className="input"
                aria-label={t("homework.curatorLogin")}
                placeholder={t("homework.curatorLogin")}
                maxLength={40}
                value={r.username}
                onChange={(e) => set(i, { username: e.target.value.trim() })}
              />
            </div>
            {mode === "cohort" && cohorts.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <span className="text-muted">{t("homework.curatorCohorts")}:</span>
                {cohorts.map((k) => (
                  <label key={k.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={r.cohorts.includes(k.id)}
                      onChange={(e) =>
                        set(i, {
                          cohorts: e.target.checked
                            ? [...r.cohorts, k.id]
                            : r.cohorts.filter((x) => x !== k.id),
                        })
                      }
                    />
                    {k.course} · {k.title}
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setSaved(false);
                setRows(rows.filter((_, j) => j !== i));
              }}
            >
              {t("homework.curatorRemove")}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rows.length < 20 && (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() =>
              setRows([...rows, { name: "", telegram: "", username: "", cohorts: [] }])
            }
          >
            {t("homework.curatorAdd")}
          </button>
        )}
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={save.busy || !valid}
          onClick={() => void save.run().catch(() => {})}
        >
          {t("homework.curatorsSave")}
        </button>
      </div>
      {saved && <p className="mt-2 text-xs text-ok">{t("homework.curatorsSaved")}</p>}
      <ErrorBox error={save.error} />
    </details>
  );
}

/** Быстрые ответы куратора: шаблоны комментариев (в Telegram — «#номер» ответом на уведомление). */
function RepliesCard({ replies, t }: { replies: HomeworkReply[]; t: AdminT }) {
  const router = useRouter();
  const [rows, setRows] = useState<HomeworkReply[]>(replies);
  const [saved, setSaved] = useState(false);
  const edit = (i: number, patch: Partial<HomeworkReply>) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const save = useAction(async () => {
    const r = await saveHwRepliesFn({ data: { replies: rows } });
    setRows(r.replies);
    setSaved(true);
    await router.invalidate();
  });
  return (
    <details className="mb-4 rounded-md border border-line p-3 text-sm" open={rows.length > 0}>
      <summary className="cursor-pointer font-medium">
        {t("homework.replies")} · {rows.length}
      </summary>
      <p className="mt-2 text-xs text-muted">{t("homework.repliesHint")}</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-start gap-2">
            <span className="w-5 pt-2 text-xs tabular-nums text-muted">{i + 1}.</span>
            <input
              className="input w-40"
              maxLength={HW_REPLY_TITLE_MAX}
              placeholder={t("homework.replyTitle")}
              value={r.title}
              onChange={(e) => edit(i, { title: e.target.value })}
            />
            <textarea
              className="input min-h-10 min-w-0 flex-1"
              maxLength={HW_REPLY_TEXT_MAX}
              placeholder={t("homework.replyText")}
              value={r.text}
              onChange={(e) => edit(i, { text: e.target.value })}
            />
            <button
              type="button"
              className="btn-ghost text-xs"
              aria-label={t("homework.replyRemove")}
              onClick={() => {
                setSaved(false);
                setRows(rows.filter((_, j) => j !== i));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          {rows.length < HW_REPLIES_MAX && (
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setRows([...rows, { title: "", text: "" }])}
            >
              {t("homework.replyAdd")}
            </button>
          )}
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={save.busy}
            onClick={() => void save.run().catch(() => {})}
          >
            {t("homework.repliesSave")}
          </button>
          {saved && <span className="text-xs text-ok">{t("homework.repliesSaved")}</span>}
        </div>
        <ErrorBox error={save.error} />
      </div>
    </details>
  );
}
