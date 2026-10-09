import { useState } from "react";
import { createNextCohortFn } from "@/app/admin/courses.functions";
import type { AdminT } from "@/app/i18n/admin";
import { ErrorBox, useAction } from "@/app/ui";
import { COHORTS_MAX } from "@/core/courses/course";
import { type Cohort } from "@/core/courses/cohort";
import { LivesField } from "./lives";

/** Потоки курса. */

/** Потоки: название, старт, последний день набора. */
export function CohortsField({
  productId,
  cohorts,
  onChange,
  t,
}: {
  productId: string;
  cohorts: Cohort[];
  onChange: (c: Cohort[]) => void;
  t: AdminT;
}) {
  const edit = (i: number, patch: Partial<Cohort>) =>
    onChange(cohorts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const [nextDay, setNextDay] = useState("");
  // Копию создаёт сервер (уже записанного курса); здесь поток только добавляется в форму.
  const createNext = useAction(async () => {
    const created = await createNextCohortFn({ data: { productId, startDay: nextDay } });
    onChange([...cohorts, created]);
    setNextDay("");
  });
  return (
    <div className="mb-3 space-y-2 text-sm">
      <p className="text-xs text-muted">{t("product.courseCohorts")}</p>
      {cohorts.map((c, i) => (
        <div key={c.id} className="flex flex-wrap items-end gap-2 rounded border border-line p-2">
          <input
            id={`cohort-title-${c.id}`}
            className="input min-w-0 flex-1"
            placeholder={t("product.cohortTitle")}
            maxLength={100}
            value={c.title}
            onChange={(e) => edit(i, { title: e.target.value })}
          />
          <label className="text-xs">
            {t("product.cohortStart")}
            <input
              id={`cohort-start-${c.id}`}
              type="datetime-local"
              className="input mt-1 block w-auto"
              value={c.start}
              onChange={(e) => edit(i, { start: e.target.value.slice(0, 16) })}
            />
          </label>
          <label className="text-xs">
            {t("product.cohortEnrollUntil")}
            <input
              id={`cohort-until-${c.id}`}
              type="date"
              className="input mt-1 block w-auto"
              value={c.enrollUntil ?? ""}
              onChange={(e) => edit(i, { enrollUntil: e.target.value || null })}
            />
          </label>
          <label className="w-full text-xs">
            {t("product.cohortChat")}
            <input
              id={`cohort-chat-${c.id}`}
              className="input mt-1 block w-full"
              placeholder="-1001234567890"
              maxLength={40}
              title={t("product.cohortChatHint")}
              value={c.chat ?? ""}
              onChange={(e) => edit(i, { chat: e.target.value.trim() || null })}
            />
          </label>
          <button
            type="button"
            className="btn-ghost"
            aria-label={t("product.cohortDelete")}
            onClick={() => onChange(cohorts.filter((_, j) => j !== i))}
          >
            ✕
          </button>
          <LivesField
            productId={productId}
            cohortId={c.id}
            lives={c.lives ?? []}
            onChange={(lives) => edit(i, { lives })}
            t={t}
          />
        </div>
      ))}
      {cohorts.length < COHORTS_MAX && (
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() =>
            onChange([
              ...cohorts,
              {
                id: crypto.randomUUID(),
                title: "",
                start: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 11) + "10:00",
                enrollUntil: null,
              },
            ])
          }
        >
          {t("product.cohortAdd")}
        </button>
      )}
      {cohorts.length > 0 && cohorts.length < COHORTS_MAX && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-line p-2">
          <label className="text-xs">
            {t("school.nextCohortStart")}
            <input
              id="cohort-next-day"
              type="date"
              className="input mt-1 block w-auto"
              value={nextDay}
              onChange={(e) => setNextDay(e.target.value)}
            />
          </label>
          <button
            type="button"
            id="cohort-next-create"
            className="btn-secondary text-xs"
            disabled={!nextDay || createNext.busy}
            onClick={() => void createNext.run().catch(() => {})}
          >
            {t("school.nextCohortCreate")}
          </button>
          <p className="w-full text-xs text-muted">{t("school.nextCohortHint")}</p>
          <ErrorBox error={createNext.error} />
        </div>
      )}
      <p className="text-xs text-muted">{t("product.courseCohortsHint")}</p>
      {cohorts.some((c) => c.chat) && (
        <p className="text-xs text-muted">{t("product.cohortChatHint")}</p>
      )}
    </div>
  );
}
