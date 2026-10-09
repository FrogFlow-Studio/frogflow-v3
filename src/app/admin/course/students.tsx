import { useEffect, useState } from "react";
import {
  channelStrangersFn,
  kickChannelStrangerFn,
  extendStudentAccessFn,
  moveStudentCohortFn,
  resetQuizAttemptsFn,
  courseStudentsFn,
  revokeStudentChannelFn,
} from "@/app/admin/courses.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import { type Cohort } from "@/core/courses/cohort";

/** Ученики курса: доступ и посторонние в канале. */

type StudentsData = Awaited<ReturnType<typeof courseStudentsFn>>;

/** Прогресс учеников: кто купил, открывал ли курс, сколько уроков пройдено. */
export function Students({
  productId,
  cohortList,
  t,
}: {
  productId: string;
  cohortList: Cohort[];
  t: AdminT;
}) {
  const [data, setData] = useState<StudentsData | null>(null);
  const [cohort, setCohort] = useState<string>("");
  const [onlyBehind, setOnlyBehind] = useState(false);
  const load = () => courseStudentsFn({ data: { productId } }).then(setData, () => setData(null));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const revoke = useAction(async (orderItemId: string) => {
    if (!window.confirm(t("product.studentRevokeConfirm"))) return;
    await revokeStudentChannelFn({ data: { orderItemId } });
    await load();
  });
  const move = useAction(async (orderItemId: string, cohortId: string) => {
    const to = cohortList.find((c) => c.id === cohortId);
    if (!to || !window.confirm(t("product.studentMoveConfirm", { cohort: to.title }))) return;
    const r = await moveStudentCohortFn({ data: { orderItemId, cohortId } });
    if (!r.ok) throw new Error(t("product.studentMoveFailed"));
    await load();
  });
  const resetQuiz = useAction(async (orderItemId: string) => {
    const r = await resetQuizAttemptsFn({ data: { orderItemId } });
    if (!r.ok || r.reset === 0) throw new Error(t("school.quizResetFailed"));
    window.alert(t("school.quizResetDone"));
    await load();
  });
  if (!data) return null;
  const cohorts = [...new Set(data.students.flatMap((s) => (s.cohort ? [s.cohort] : [])))];
  const shown = data.students.filter(
    (s) => (!cohort || s.cohort === cohort) && (!onlyBehind || s.behind),
  );
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-medium">
          {t("product.courseStudents")} · {shown.length}
        </h3>
        {cohorts.length > 0 && (
          <select
            className="input w-auto text-xs"
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
          >
            <option value="">{t("product.studentAllCohorts")}</option>
            {cohorts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={onlyBehind}
            onChange={(e) => setOnlyBehind(e.target.checked)}
          />
          {t("product.studentBehindOnly")}
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t("product.courseStudentsEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {shown.map((s) => (
            <li key={s.orderItemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                #{s.orderNo}
                {s.buyer ? ` · ${s.buyer}` : ""}
                {s.tariff ? ` · ${s.tariff}` : ""}
                {s.cohort ? ` · ${s.cohort}` : ""}
              </span>
              {s.behind && (
                <span className="badge text-xs text-warn">{t("product.studentBehind")}</span>
              )}
              {s.expired && <span className="badge text-xs">{t("product.studentExpired")}</span>}
              {s.accessLimited && s.expiresAt && !s.expired && (
                <span className="text-xs text-muted">
                  {t("product.studentExtendUntil", {
                    date: new Date(s.expiresAt).toLocaleDateString(),
                  })}
                </span>
              )}
              {s.accessLimited && <ExtendAccess orderItemId={s.orderItemId} t={t} onDone={load} />}
              {s.quiz.attempts > 0 && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={resetQuiz.busy}
                  onClick={() => void resetQuiz.run(s.orderItemId).catch(() => {})}
                >
                  {t("school.quizResetAttempts")}
                </button>
              )}
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {s.startedAt
                  ? t("product.courseProgress", { done: s.done, total: data.total, open: s.open })
                  : t("product.courseNotStarted")}
                {s.homework.submitted + s.homework.accepted + s.homework.revise > 0 &&
                  ` · 📝 ${t("product.studentHomework", {
                    accepted: s.homework.accepted,
                    waiting: s.homework.submitted,
                    revise: s.homework.revise,
                  })}`}
              </span>
              {cohortList.length > 1 && (
                <select
                  className="input w-auto text-xs"
                  aria-label={t("product.studentMove")}
                  disabled={move.busy}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      void move.run(s.orderItemId, e.target.value).catch(() => {});
                  }}
                >
                  <option value="">{t("product.studentMove")}</option>
                  {cohortList
                    .filter((c) => c.id !== s.cohortId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </select>
              )}
              {s.inChannel && (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={revoke.busy}
                  onClick={() => void revoke.run(s.orderItemId).catch(() => {})}
                >
                  {t("product.studentRevoke")}
                </button>
              )}
              {s.channelRevoked && (
                <span className="text-xs text-muted">{t("product.studentRevoked")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={revoke.error ?? move.error} />
    </div>
  );
}

/** Продление доступа одному ученику: дата и обязательная причина. */
function ExtendAccess({
  orderItemId,
  t,
  onDone,
}: {
  orderItemId: string;
  t: AdminT;
  onDone: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const extend = useAction(async () => {
    const r = await extendStudentAccessFn({ data: { orderItemId, day, reason } });
    if (!r.ok) {
      throw new Error(
        r.reason === "notLater"
          ? t("product.studentExtendNotLater")
          : r.reason === "noReason"
            ? t("product.studentExtendNoReason")
            : t("product.studentExtendFailed"),
      );
    }
    setOpen(false);
    setDay("");
    setReason("");
    await onDone();
  });
  if (!open)
    return (
      <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        {t("product.studentExtend")}
      </button>
    );
  return (
    <span className="flex w-full flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs">
        {t("product.studentExtendDay")}
        <input
          type="date"
          className="input w-auto text-xs"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <input
        className="input min-w-0 flex-1 text-xs"
        placeholder={t("product.studentExtendReason")}
        maxLength={300}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={extend.busy || !day || !reason.trim()}
        onClick={() => void extend.run().catch(() => {})}
      >
        {t("product.studentExtendSave")}
      </button>
      <ErrorBox error={extend.error} />
    </span>
  );
}

/**
 * «В канале без доступа»: бот видел их вступившими, а действующей покупки
 * нет. Telegram не отдаёт полный список участников — только тех, кого увидел бот.
 */
export function Strangers({
  channel,
  label,
  list,
  reload,
  t,
}: {
  channel: string;
  label: string;
  list: Awaited<ReturnType<typeof channelStrangersFn>> | null;
  reload: () => Promise<unknown>;
  t: AdminT;
}) {
  const kick = useAction(async (userId: number) => {
    if (!window.confirm(t("product.strangerKickConfirm"))) return;
    const r = await kickChannelStrangerFn({ data: { channel, userId } });
    if (!r.kicked) throw new Error(t("product.strangerKickFailed"));
    await reload();
  });
  const mine = (list ?? []).filter((x) => x.channel === channel);
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-1 text-sm font-medium">
        {t("product.strangers")} · {label} ({channel}) · {mine.length}
      </h3>
      <p className="mb-2 text-xs text-muted">{t("product.strangersHint")}</p>
      {mine.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {mine.map((x) => (
            <li key={x.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                {x.name || t("product.strangerNoName")} · id {x.userId}
              </span>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={kick.busy}
                onClick={() => void kick.run(x.userId).catch(() => {})}
              >
                {t("product.strangerKick")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={kick.error} />
    </div>
  );
}
