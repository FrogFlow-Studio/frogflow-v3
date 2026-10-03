import { useState } from "react";
import type { AdminT } from "@/app/i18n/admin";
import {
  LESSON_TITLE_MAX,
  LESSONS_MAX,
  parseLessonList,
  type LessonListSkip,
} from "@/core/courses/course";

/**
 * «Добавить уроки списком» в карточке курса: строки «Название — ссылка»
 * становятся новыми уроками в конце (до лимита). Не взятые строки остаются в
 * поле с причиной — их можно поправить и отправить снова. Уроки попадают в
 * форму; в базу они уходят кнопкой «Сохранить» вместе с курсом.
 */
export function LessonListAdd({
  existing,
  onAdd,
  t,
}: {
  existing: number;
  onAdd: (lessons: Array<{ title: string; link: string | null }>) => void;
  t: AdminT;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const reason = (s: LessonListSkip) =>
    t(
      s.reason === "notHttps"
        ? "school.listNotHttps"
        : s.reason === "noTitle"
          ? "school.listNoTitle"
          : "school.listTooLong",
      { line: s.line, max: LESSON_TITLE_MAX },
    );
  const submit = () => {
    const r = parseLessonList(text, existing);
    if (!r.lessons.length && !r.skipped.length && !r.overLimit) {
      setNotes([t("school.listEmpty")]);
      return;
    }
    if (r.lessons.length) onAdd(r.lessons);
    setText(r.leftover);
    setNotes([
      ...(r.lessons.length
        ? [t("school.listAdded", { n: r.lessons.length }), t("school.listSaveHint")]
        : []),
      ...r.skipped.slice(0, 5).map(reason),
      ...(r.skipped.length > 5
        ? [
            t("school.listSkipped", {
              n: r.skipped.length,
              lines: r.skipped.map((s) => s.line).join(", "),
            }),
          ]
        : []),
      ...(r.overLimit ? [t("school.listOver", { n: r.overLimit, max: LESSONS_MAX })] : []),
    ]);
    if (!r.leftover) setOpen(false);
  };
  if (!open)
    return (
      <button
        type="button"
        id="lesson-list-open"
        className="btn-secondary"
        disabled={existing >= LESSONS_MAX}
        onClick={() => setOpen(true)}
      >
        {t("school.listAdd")}
      </button>
    );
  return (
    <div className="w-full space-y-2 rounded border border-line p-3">
      <p className="text-xs text-muted">{t("school.listHint", { max: LESSONS_MAX })}</p>
      <textarea
        id="lesson-list-text"
        className="input min-h-32"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" id="lesson-list-submit" className="btn-primary" onClick={submit}>
          {t("school.listSubmit")}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          {t("school.listCancel")}
        </button>
      </div>
      {notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted" role="status">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
