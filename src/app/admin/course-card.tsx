import { useEffect, useState } from "react";
import { channelStrangersFn, courseFn, saveCourseFn } from "@/app/admin/courses.functions";
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
  HOMEWORK_DAYS_MAX,
} from "@/core/courses/course";
import { LessonListAdd } from "@/app/admin/lesson-list-add";
import { LessonQuizEditor } from "@/app/admin/lesson-quiz-editor";
import { ChannelField } from "./course/channel";
import { CohortsField } from "./course/cohorts";
import { TariffsField } from "./course/tariffs";
import { Students, Strangers } from "./course/students";

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
          (sent, total) =>
            setUploading(
              `${file.name} (${total > 0 ? Math.round((sent / total) * 100) : 0}%)`,
            ),
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
      <label className="mb-3 flex items-start gap-2 text-sm">
        <input
          id="course-tutor"
          type="checkbox"
          className="mt-0.5"
          checked={course.tutor === true}
          onChange={(e) => change({ ...course, tutor: e.target.checked })}
        />
        <span>
          {t("tutor.toggle")}
          <span className="mt-1 block text-xs text-muted">{t("tutor.toggleHint")}</span>
        </span>
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
