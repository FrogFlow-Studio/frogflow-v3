import { useEffect, useState } from "react";
import {
  channelStrangersFn,
  checkCourseChannelFn,
  kickChannelStrangerFn,
  extendStudentAccessFn,
  moveStudentCohortFn,
  resetQuizAttemptsFn,
  courseFn,
  courseVariantsFn,
  createNextCohortFn,
  deleteLiveFn,
  saveLiveFn,
  courseStudentsFn,
  revokeStudentChannelFn,
  saveCourseFn,
} from "@/app/admin/courses.functions";
import { uploadFile } from "@/app/admin/upload-client";
import type { AdminT } from "@/app/i18n/admin";
import { Card, ErrorBox, useAction } from "@/app/ui";
import {
  DRIP_DAYS_MAX,
  DRIP_DAYS_MIN,
  LESSON_FILES_MAX,
  LESSONS_MAX,
  lessonOpensAfterDays,
  type Course,
  type Lesson,
  ACCESS_DAYS_MAX,
  COHORTS_MAX,
  HOMEWORK_DAYS_MAX,
} from "@/core/courses/course";
import { LessonListAdd } from "@/app/admin/lesson-list-add";
import { LessonQuizEditor } from "@/app/admin/lesson-quiz-editor";
import { DEFAULT_TARIFF, type Cohort, type Tariff } from "@/core/courses/cohort";
import { LIVE_LINK_MAX, LIVE_TITLE_MAX, LIVES_MAX, type Live } from "@/core/courses/live";

/**
 * Уроки курса в карточке цифрового товара (модуль courses): порядок,
 * текст, файлы, ссылка и расписание открытия. Сохраняется отдельной кнопкой,
 * как «С этим предлагать».
 */
export function CourseCard({ productId, t }: { productId: string; t: AdminT }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  // «В канале без доступа» — один обход на карточку, не по разу на каждый чат.
  const [strangers, setStrangers] = useState<Awaited<ReturnType<typeof channelStrangersFn>> | null>(
    null,
  );
  const loadStrangers = () => channelStrangersFn().then(setStrangers, () => setStrangers(null));
  useEffect(() => {
    void courseFn({ data: { productId } }).then(setCourse);
    void loadStrangers();
  }, [productId]);
  const save = useAction(async () => {
    if (!course) return;
    await saveCourseFn({ data: { productId, course } });
    setSaved(true);
    await loadStrangers();
  });
  const upload = useAction(async (index: number, files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      setUploading(file.name);
      try {
        const key = await uploadFile("file", file, t, (status) =>
          t("product.uploadFailed", { status }),
        );
        edit(index, (l) => ({ ...l, files: [...l.files, { path: key, name: file.name }] }));
      } finally {
        setUploading(null);
      }
    }
  });
  if (!course) return null;

  const change = (next: Course) => {
    setSaved(false);
    setCourse(next);
  };
  function edit(index: number, f: (l: Lesson) => Lesson) {
    setSaved(false);
    setCourse((c) => c && { ...c, lessons: c.lessons.map((l, i) => (i === index ? f(l) : l)) });
  }
  const move = (index: number, by: -1 | 1) => {
    const lessons = course.lessons.slice();
    const [l] = lessons.splice(index, 1);
    lessons.splice(index + by, 0, l!);
    change({ ...course, lessons });
  };
  const add = () =>
    change({
      ...course,
      lessons: [
        ...course.lessons,
        { id: crypto.randomUUID(), title: "", text: "", files: [], link: null },
      ],
    });
  const addList = (list: Array<{ title: string; link: string | null }>) =>
    change({
      ...course,
      lessons: [
        ...course.lessons,
        ...list.map((x) => ({
          id: crypto.randomUUID(),
          title: x.title,
          text: "",
          files: [],
          link: x.link,
        })),
      ],
    });
  const drip = course.schedule.mode === "drip" ? course.schedule.everyDays : null;

  return (
    <Card title={t("product.card.course")}>
      <p className="mb-3 text-xs text-muted">{t("product.courseHint")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          id="course-schedule"
          className="input w-auto"
          value={course.schedule.mode}
          onChange={(e) =>
            change({
              ...course,
              schedule:
                e.target.value === "drip"
                  ? { mode: "drip", everyDays: 1 }
                  : e.target.value === "tasks"
                    ? { mode: "tasks", unlock: "accepted" }
                    : { mode: "all" },
            })
          }
        >
          <option value="all">{t("product.courseScheduleAll")}</option>
          <option value="drip">{t("product.courseScheduleDrip")}</option>
          <option value="tasks">{t("school.scheduleTasks")}</option>
        </select>
        {course.schedule.mode === "tasks" && (
          <select
            id="course-unlock"
            className="input w-auto"
            value={course.schedule.unlock}
            onChange={(e) =>
              change({
                ...course,
                schedule: {
                  mode: "tasks",
                  unlock: e.target.value === "submitted" ? "submitted" : "accepted",
                },
              })
            }
          >
            <option value="accepted">{t("school.unlockAccepted")}</option>
            <option value="submitted">{t("school.unlockSubmitted")}</option>
          </select>
        )}
        {drip != null && (
          <label className="flex items-center gap-2">
            {t("product.courseEveryDays")}
            <input
              id="course-every-days"
              type="number"
              className="input w-20"
              min={DRIP_DAYS_MIN}
              max={DRIP_DAYS_MAX}
              value={drip}
              onChange={(e) =>
                change({
                  ...course,
                  schedule: {
                    mode: "drip",
                    everyDays: Math.min(
                      DRIP_DAYS_MAX,
                      Math.max(DRIP_DAYS_MIN, Math.round(Number(e.target.value) || 1)),
                    ),
                  },
                })
              }
            />
          </label>
        )}
      </div>

      {course.schedule.mode === "tasks" && (
        <p className="mb-3 text-xs text-muted">{t("school.scheduleTasksHint")}</p>
      )}
      <label className="mb-3 block text-sm">
        <span className="text-xs text-muted">{t("product.courseHomeworkDays")}</span>
        <input
          id="course-homework-days"
          type="number"
          className="input mt-1 w-24"
          min={1}
          max={HOMEWORK_DAYS_MAX}
          value={course.homeworkDays ?? ""}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            change({
              ...course,
              homeworkDays: e.target.value && n >= 1 ? Math.min(n, HOMEWORK_DAYS_MAX) : null,
            });
          }}
        />
        <span className="mt-1 block text-xs text-muted">{t("product.courseHomeworkDaysHint")}</span>
      </label>
      <p className="mb-3 text-xs text-muted">{t("product.lessonVideoHint")}</p>
      <ChannelField
        value={course.channel ?? ""}
        onChange={(v) => change({ ...course, channel: v || null })}
        t={t}
      />

      <CohortsField
        productId={productId}
        cohorts={course.cohorts ?? []}
        onChange={(cohorts) => change({ ...course, cohorts })}
        t={t}
      />
      <TariffsField
        productId={productId}
        tariffs={course.tariffs ?? {}}
        onChange={(tariffs) => change({ ...course, tariffs })}
        t={t}
      />

      {course.lessons.length === 0 && (
        <p className="mb-2 text-sm text-muted">{t("product.courseEmpty")}</p>
      )}
      <ol className="space-y-3">
        {course.lessons.map((l, i) => {
          const day = lessonOpensAfterDays(course.schedule, i);
          return (
            <li key={l.id} className="rounded border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">{i + 1}.</span>
                <input
                  id={`lesson-title-${l.id}`}
                  className="input min-w-0 flex-1"
                  placeholder={t("product.lessonTitle")}
                  maxLength={200}
                  value={l.title}
                  onChange={(e) => edit(i, (x) => ({ ...x, title: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label={t("product.lessonUp")}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label={t("product.lessonDown")}
                  disabled={i === course.lessons.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label={t("product.lessonDelete")}
                  onClick={() =>
                    change({ ...course, lessons: course.lessons.filter((_, j) => j !== i) })
                  }
                >
                  ✕
                </button>
              </div>
              <textarea
                id={`lesson-text-${l.id}`}
                className="input mb-2 min-h-20"
                placeholder={t("product.lessonText")}
                maxLength={4000}
                value={l.text}
                onChange={(e) => edit(i, (x) => ({ ...x, text: e.target.value }))}
              />
              <input
                id={`lesson-link-${l.id}`}
                className="input mb-2"
                type="url"
                placeholder={t("product.lessonLink")}
                value={l.link ?? ""}
                onChange={(e) => edit(i, (x) => ({ ...x, link: e.target.value.trim() || null }))}
              />
              <label className="mb-2 flex items-start gap-2 text-sm">
                <input
                  id={`lesson-preview-${l.id}`}
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(l.preview)}
                  onChange={(e) => edit(i, (x) => ({ ...x, preview: e.target.checked }))}
                />
                <span>{t("school.lessonPreview")}</span>
              </label>
              <LessonQuizEditor
                lessonId={l.id}
                quiz={l.quiz}
                onChange={(quiz) => edit(i, (x) => ({ ...x, quiz }))}
                t={t}
              />
              <textarea
                id={`lesson-homework-${l.id}`}
                className="input mb-2 min-h-16"
                placeholder={t("product.lessonHomework")}
                maxLength={2000}
                value={l.homework ?? ""}
                onChange={(e) => edit(i, (x) => ({ ...x, homework: e.target.value || null }))}
              />
              <ul className="mb-2 space-y-1 text-sm">
                {l.files.map((f, j) => (
                  <li key={f.path} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {f.name ?? f.path.split("/").pop()}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        edit(i, (x) => ({ ...x, files: x.files.filter((_, k) => k !== j) }))
                      }
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                {l.files.length < LESSON_FILES_MAX && (
                  <label className="btn-secondary cursor-pointer text-xs">
                    {t("product.lessonAddFile")}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      disabled={upload.busy}
                      onChange={(e) => void upload.run(i, e.target.files).catch(() => {})}
                    />
                  </label>
                )}
                <span className="text-muted">
                  {course.schedule.mode === "tasks" && i > 0
                    ? t("school.lessonOpensAfterTask", { n: i })
                    : day === 0
                      ? t("product.lessonOpensNow")
                      : t("product.lessonOpensDay", { day: day + 1 })}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {uploading && (
        <p className="mt-2 text-xs text-muted">{t("product.uploading", { name: uploading })}</p>
      )}
      <ErrorBox error={upload.error} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {course.lessons.length < LESSONS_MAX && (
          <button type="button" className="btn-secondary" onClick={add}>
            {t("product.lessonAdd")}
          </button>
        )}
        <LessonListAdd existing={course.lessons.length} onAdd={addList} t={t} />
        <button
          type="button"
          className="btn-primary"
          disabled={save.busy || upload.busy}
          onClick={() => void save.run().catch(() => {})}
        >
          {t("common.save")}
        </button>
        {saved && <span className="text-xs text-ok">✓</span>}
      </div>
      <ErrorBox error={save.error} />
      <Students productId={productId} cohortList={course.cohorts ?? []} t={t} />
      {[
        ...(course.channel ? [{ chat: course.channel, label: t("product.strangersChannel") }] : []),
        ...(course.cohorts ?? []).flatMap((c) =>
          c.chat ? [{ chat: c.chat, label: t("product.strangersChat", { cohort: c.title }) }] : [],
        ),
      ]
        .filter((x, i, all) => all.findIndex((y) => y.chat === x.chat) === i)
        .map((x) => (
          <Strangers
            key={x.chat}
            channel={x.chat}
            label={x.label}
            list={strangers}
            reload={loadStrangers}
            t={t}
          />
        ))}
    </Card>
  );
}

/**
 * Эфиры потока (Ш1): каждый записывается сразу своей кнопкой, отдельно от
 * «Сохранить курс». Id нового эфира задаёт форма: повтор запроса — тот же эфир.
 */
function LivesField({
  productId,
  cohortId,
  lives,
  onChange,
  t,
}: {
  productId: string;
  cohortId: string;
  lives: Live[];
  onChange: (l: Live[]) => void;
  t: AdminT;
}) {
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  return (
    <div className="w-full space-y-1 border-t border-line pt-2">
      <p className="text-xs font-medium">{t("live.title")}</p>
      {lives.map((l) => (
        <LiveRow
          key={l.id}
          productId={productId}
          cohortId={cohortId}
          live={l}
          onSaved={onChange}
          t={t}
        />
      ))}
      {lives.length < LIVES_MAX ? (
        <LiveRow
          key={draftId}
          productId={productId}
          cohortId={cohortId}
          live={{ id: draftId, title: "", at: "", link: null }}
          fresh
          onSaved={(next) => {
            onChange(next);
            setDraftId(crypto.randomUUID());
          }}
          t={t}
        />
      ) : (
        <p className="text-xs text-muted">{t("live.full", { max: LIVES_MAX })}</p>
      )}
      <p className="text-xs text-muted">{t("live.hint")}</p>
    </div>
  );
}

function LiveRow({
  productId,
  cohortId,
  live,
  fresh = false,
  onSaved,
  t,
}: {
  productId: string;
  cohortId: string;
  live: Live;
  fresh?: boolean;
  onSaved: (l: Live[]) => void;
  t: AdminT;
}) {
  const [title, setTitle] = useState(live.title);
  const [at, setAt] = useState(live.at);
  const [link, setLink] = useState(live.link ?? "");
  const save = useAction(async () =>
    onSaved(
      await saveLiveFn({
        data: { productId, cohortId, live: { id: live.id, title, at, link: link.trim() || null } },
      }),
    ),
  );
  const remove = useAction(async () => {
    if (!window.confirm(t("live.deleteConfirm", { title: live.title }))) return;
    onSaved(await deleteLiveFn({ data: { productId, cohortId, liveId: live.id } }));
  });
  const changed = title !== live.title || at !== live.at || link !== (live.link ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input
        id={`live-title-${live.id}`}
        className="input min-w-0 flex-1"
        placeholder={t("live.name")}
        maxLength={LIVE_TITLE_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        id={`live-at-${live.id}`}
        type="datetime-local"
        aria-label={t("live.at")}
        className="input w-auto"
        value={at}
        onChange={(e) => setAt(e.target.value.slice(0, 16))}
      />
      <input
        id={`live-link-${live.id}`}
        className="input min-w-0 flex-1"
        placeholder="https://zoom.us/j/…"
        aria-label={t("live.link")}
        maxLength={LIVE_LINK_MAX}
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <button
        type="button"
        id={`live-save-${live.id}`}
        className="btn-secondary text-xs"
        disabled={save.busy || !changed || !title.trim() || !at}
        onClick={() => void save.run().catch(() => {})}
      >
        {fresh ? t("live.add") : t("live.save")}
      </button>
      {!fresh && (
        <button
          type="button"
          className="btn-ghost"
          aria-label={t("live.delete")}
          disabled={remove.busy}
          onClick={() => void remove.run().catch(() => {})}
        >
          ✕
        </button>
      )}
      <ErrorBox error={save.error ?? remove.error} />
    </div>
  );
}

/** Потоки: название, старт, последний день набора. */
function CohortsField({
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

/** Тарифы — по вариантам товара: проверка ДЗ, канал, срок доступа. */
function TariffsField({
  productId,
  tariffs,
  onChange,
  t,
}: {
  productId: string;
  tariffs: Record<string, Tariff>;
  onChange: (t: Record<string, Tariff>) => void;
  t: AdminT;
}) {
  const [variants, setVariants] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    void courseVariantsFn({ data: { productId } }).then(setVariants, () => setVariants([]));
  }, [productId]);
  if (!variants) return null;
  const set = (id: string, patch: Partial<Tariff>) =>
    onChange({ ...tariffs, [id]: { ...DEFAULT_TARIFF, ...tariffs[id], ...patch } });
  return (
    <div className="mb-3 space-y-2 text-sm">
      <p className="text-xs text-muted">{t("product.courseTariffs")}</p>
      {variants.length === 0 ? (
        <p className="text-xs text-muted">{t("product.courseTariffsNone")}</p>
      ) : (
        <>
          {variants.map((v) => {
            const cur = { ...DEFAULT_TARIFF, ...tariffs[v.id] };
            return (
              <div
                key={v.id}
                className="flex flex-wrap items-center gap-3 rounded border border-line p-2"
              >
                <span className="min-w-0 flex-1 font-medium">{v.name}</span>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={cur.homework}
                    onChange={(e) => set(v.id, { homework: e.target.checked })}
                  />
                  {t("product.tariffHomework")}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={cur.channel}
                    onChange={(e) => set(v.id, { channel: e.target.checked })}
                  />
                  {t("product.tariffChannel")}
                </label>
                <label className="flex items-center gap-1 text-xs">
                  {t("product.tariffAccessDays")}
                  <input
                    type="number"
                    className="input w-20"
                    min={1}
                    max={ACCESS_DAYS_MAX}
                    value={cur.accessDays ?? ""}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      set(v.id, {
                        accessDays: e.target.value && n >= 1 ? Math.min(n, ACCESS_DAYS_MAX) : null,
                      });
                    }}
                  />
                </label>
              </div>
            );
          })}
          <p className="text-xs text-muted">{t("product.courseTariffsHint")}</p>
        </>
      )}
    </div>
  );
}

type ChannelCheck = Awaited<ReturnType<typeof checkCourseChannelFn>>;

/** Закрытый канал курса: id или @имя и проверка, что бот может приглашать. */
function ChannelField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: AdminT;
}) {
  const [checked, setChecked] = useState<ChannelCheck | null>(null);
  const check = useAction(async () => {
    setChecked(await checkCourseChannelFn({ data: { channel: value } }));
  });
  return (
    <div className="mb-3 space-y-1 text-sm">
      <label className="block text-xs text-muted" htmlFor="course-channel">
        {t("product.courseChannel")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="course-channel"
          className="input min-w-0 flex-1"
          placeholder="-1001234567890"
          maxLength={40}
          value={value}
          onChange={(e) => {
            setChecked(null);
            onChange(e.target.value.trim());
          }}
        />
        {value && (
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={check.busy}
            onClick={() => void check.run().catch(() => {})}
          >
            {t("product.courseChannelCheck")}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">{t("product.courseChannelHint")}</p>
      {checked && (
        <p className={`text-xs ${checked.ok ? "text-ok" : "text-warn"}`}>
          {checked.ok
            ? t("product.courseChannelOk", { title: checked.title })
            : t(`product.courseChannelErr.${checked.reason}`)}
        </p>
      )}
      <ErrorBox error={check.error} />
    </div>
  );
}

type StudentsData = Awaited<ReturnType<typeof courseStudentsFn>>;

/** Прогресс учеников: кто купил, открывал ли курс, сколько уроков пройдено. */
function Students({
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
function Strangers({
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
