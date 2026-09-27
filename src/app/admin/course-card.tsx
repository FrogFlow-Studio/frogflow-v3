import { useEffect, useState } from "react";
import { courseFn, courseStudentsFn, saveCourseFn } from "@/app/admin/courses.functions";
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
} from "@/core/courses/course";

/**
 * Уроки курса в карточке цифрового товара (модуль courses): порядок,
 * текст, файлы, ссылка и расписание открытия. Сохраняется отдельной кнопкой,
 * как «С этим предлагать».
 */
export function CourseCard({ productId, t }: { productId: string; t: AdminT }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  useEffect(() => {
    void courseFn({ data: { productId } }).then(setCourse);
  }, [productId]);
  const save = useAction(async () => {
    if (!course) return;
    await saveCourseFn({ data: { productId, course } });
    setSaved(true);
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
  const drip = course.schedule.mode === "drip" ? course.schedule.everyDays : null;

  return (
    <Card title={t("product.card.course")}>
      <p className="mb-3 text-xs text-muted">{t("product.courseHint")}</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          id="course-schedule"
          className="input w-auto"
          value={drip == null ? "all" : "drip"}
          onChange={(e) =>
            change({
              ...course,
              schedule:
                e.target.value === "drip" ? { mode: "drip", everyDays: 1 } : { mode: "all" },
            })
          }
        >
          <option value="all">{t("product.courseScheduleAll")}</option>
          <option value="drip">{t("product.courseScheduleDrip")}</option>
        </select>
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
                  {day === 0
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

      <div className="mt-3 flex items-center gap-3">
        {course.lessons.length < LESSONS_MAX && (
          <button type="button" className="btn-secondary" onClick={add}>
            {t("product.lessonAdd")}
          </button>
        )}
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
      <Students productId={productId} t={t} />
    </Card>
  );
}

type StudentsData = Awaited<ReturnType<typeof courseStudentsFn>>;

/** Прогресс учеников: кто купил, открывал ли курс, сколько уроков пройдено. */
function Students({ productId, t }: { productId: string; t: AdminT }) {
  const [data, setData] = useState<StudentsData | null>(null);
  useEffect(() => {
    void courseStudentsFn({ data: { productId } }).then(setData, () => setData(null));
  }, [productId]);
  if (!data) return null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-medium">
        {t("product.courseStudents")} · {data.students.length}
      </h3>
      {data.students.length === 0 ? (
        <p className="text-sm text-muted">{t("product.courseStudentsEmpty")}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {data.students.map((s) => (
            <li key={s.orderNo} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate">
                #{s.orderNo}
                {s.buyer ? ` · ${s.buyer}` : ""}
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {s.startedAt
                  ? t("product.courseProgress", { done: s.done, total: data.total, open: s.open })
                  : t("product.courseNotStarted")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
