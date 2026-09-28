/**
 * Домашние задания курса (ниша «Онлайн-школа», docs/COURSES-NICHE.md).
 *
 * Задание — поле урока (`Lesson.homework`). Ответ ученика на урок одной
 * покупки — одна запись в `app_settings.hw_<позиция заказа>_<урок>`: схему не
 * меняем, ключ по позиции — как у прохождения курса (`course_run_`), чтобы
 * работало и для покупателей из Instagram и WhatsApp. Файлы — в бакете
 * product-files под `<bot_id>/hw/<позиция>/`.
 *
 * Запись меняется только условно (`rev`): новая сдача ученика не затрёт
 * проверку преподавателя и наоборот. Чистый модуль.
 */
export const HW_KEY_PREFIX = "hw_";
export const HW_TEXT_MAX = 4000;
export const HW_FEEDBACK_MAX = 4000;
export const HW_FILES_MAX = 5;
/** Сколько последних сдач хранить (история доработок). */
export const HW_ATTEMPTS_MAX = 10;
/** Файл ответа — до 3 МБ: тело запроса функции на Vercel ~4,5 МБ, файл идёт в base64. */
export const HW_FILE_MAX_BYTES = 3 * 1024 * 1024;

export type HomeworkStatus = "submitted" | "accepted" | "revise";
export type HomeworkFile = { path: string; name: string | null; mime: string };
export type HomeworkAttempt = {
  at: string;
  text: string;
  files: HomeworkFile[];
  /** Альбом Telegram (media_group_id): части альбома — одна сдача. */
  group?: string;
};
export type HomeworkFeedback = { at: string; text: string; by: string; status: HomeworkStatus };

export type Homework = {
  rev: number;
  orderItemId: string;
  lessonId: string;
  productId: string;
  course: string;
  lessonNo: number;
  lessonTitle: string;
  /** Как показать ученика преподавателю. */
  student: string;
  status: HomeworkStatus;
  attempts: HomeworkAttempt[];
  feedback: HomeworkFeedback | null;
  updatedAt: string;
};

export const hwKey = (orderItemId: string, lessonId: string) =>
  `${HW_KEY_PREFIX}${orderItemId}_${lessonId}`;

/** Папка файлов ответа: только под ней принимаются ключи файлов сдачи. */
export const hwFolder = (tenantId: string, orderItemId: string) => `${tenantId}/hw/${orderItemId}/`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly HomeworkStatus[] = ["submitted", "accepted", "revise"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function parseFiles(v: unknown): HomeworkFile[] {
  if (!Array.isArray(v)) return [];
  return v
    .flatMap((f) => {
      const o = (f ?? {}) as Record<string, unknown>;
      const path = str(o.path, 300);
      return path ? [{ path, name: str(o.name, 200) || null, mime: str(o.mime, 100) }] : [];
    })
    .slice(0, HW_FILES_MAX);
}

/** Запись из app_settings; битая — null (сдачи как будто нет). */
export function parseHomework(raw: string | null | undefined): Homework | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const status = STATUSES.includes(o.status as HomeworkStatus)
    ? (o.status as HomeworkStatus)
    : null;
  const orderItemId = str(o.orderItemId, 36);
  const lessonId = str(o.lessonId, 36);
  if (!status || !UUID.test(orderItemId) || !UUID.test(lessonId)) return null;
  const attempts = (Array.isArray(o.attempts) ? o.attempts : [])
    .flatMap((a) => {
      const x = (a ?? {}) as Record<string, unknown>;
      const at = str(x.at, 40);
      const group = str(x.group, 40);
      return Number.isFinite(Date.parse(at))
        ? [
            {
              at,
              text: str(x.text, HW_TEXT_MAX),
              files: parseFiles(x.files),
              ...(group ? { group } : {}),
            },
          ]
        : [];
    })
    .slice(-HW_ATTEMPTS_MAX);
  const fb = (o.feedback ?? null) as Record<string, unknown> | null;
  const feedback =
    fb && typeof fb === "object" && STATUSES.includes(fb.status as HomeworkStatus)
      ? {
          at: str(fb.at, 40),
          text: str(fb.text, HW_FEEDBACK_MAX),
          by: str(fb.by, 100),
          status: fb.status as HomeworkStatus,
        }
      : null;
  return {
    rev: Number.isInteger(o.rev) ? (o.rev as number) : 0,
    orderItemId,
    lessonId,
    productId: str(o.productId, 36),
    course: str(o.course, 200),
    lessonNo: Number.isInteger(o.lessonNo) ? (o.lessonNo as number) : 0,
    lessonTitle: str(o.lessonTitle, 200),
    student: str(o.student, 200),
    status,
    attempts,
    feedback,
    updatedAt: str(o.updatedAt, 40),
  };
}

export type SubmitInput = {
  orderItemId: string;
  lessonId: string;
  productId: string;
  course: string;
  lessonNo: number;
  lessonTitle: string;
  student: string;
  text: string;
  files: HomeworkFile[];
  /** Часть альбома Telegram: дописывается к сдаче того же альбома. */
  group?: string;
};

export type SubmitProblem = "empty" | "tooManyFiles" | "accepted" | "foreignFile";

/** Можно ли сдать: есть что сдать, файлы из своей папки, задание ещё не принято. */
export function submitProblem(
  tenantId: string,
  current: Homework | null,
  input: Pick<SubmitInput, "orderItemId" | "text" | "files" | "group">,
): SubmitProblem | null {
  if (current?.status === "accepted") return "accepted";
  if (!input.text.trim() && input.files.length === 0) return "empty";
  const already = mergesInto(current, input) ? (current?.attempts.at(-1)?.files.length ?? 0) : 0;
  if (already + input.files.length > HW_FILES_MAX) return "tooManyFiles";
  const folder = hwFolder(tenantId, input.orderItemId);
  if (input.files.some((f) => !f.path.startsWith(folder) || f.path.includes("..")))
    return "foreignFile";
  return null;
}

/**
 * Часть того же альбома, пока работа ещё не проверена: Telegram присылает
 * альбом отдельными сообщениями, и каждое не должно становиться «новой
 * версией» для преподавателя.
 */
export function mergesInto(current: Homework | null, input: Pick<SubmitInput, "group">): boolean {
  return Boolean(
    input.group &&
    current?.status === "submitted" &&
    current.attempts.at(-1)?.group === input.group,
  );
}

/** Новая сдача поверх прежней: попытка в историю, статус «на проверке». */
export function withSubmission(current: Homework | null, input: SubmitInput, now: Date): Homework {
  const at = now.toISOString();
  const text = input.text.trim().slice(0, HW_TEXT_MAX);
  if (current && mergesInto(current, input)) {
    const last = current.attempts.at(-1)!;
    const merged: HomeworkAttempt = {
      ...last,
      text: [last.text, text].filter(Boolean).join("\n").slice(0, HW_TEXT_MAX),
      files: [...last.files, ...input.files].slice(0, HW_FILES_MAX),
    };
    return {
      ...current,
      rev: current.rev + 1,
      attempts: [...current.attempts.slice(0, -1), merged],
      updatedAt: at,
    };
  }
  const attempt: HomeworkAttempt = {
    at,
    text,
    files: input.files.slice(0, HW_FILES_MAX),
    ...(input.group ? { group: input.group } : {}),
  };
  return {
    rev: (current?.rev ?? 0) + 1,
    orderItemId: input.orderItemId,
    lessonId: input.lessonId,
    productId: input.productId,
    course: input.course.slice(0, 200),
    lessonNo: input.lessonNo,
    lessonTitle: input.lessonTitle.slice(0, 200),
    student: input.student.slice(0, 200),
    status: "submitted",
    attempts: [...(current?.attempts ?? []), attempt].slice(-HW_ATTEMPTS_MAX),
    feedback: current?.feedback ?? null,
    updatedAt: at,
  };
}

export type ReviewInput = {
  /** Версия, которую видел преподаватель: ученик мог прислать новую. */
  rev: number;
  status: "accepted" | "revise";
  text: string;
  by: string;
};

export type ReviewProblem = "stale" | "notSubmitted" | "emptyRevise";

export function reviewProblem(current: Homework | null, r: ReviewInput): ReviewProblem | null {
  if (!current || current.status !== "submitted") return "notSubmitted";
  if (current.rev !== r.rev) return "stale";
  // Вернуть на доработку без объяснения — ученик не поймёт, что исправить.
  if (r.status === "revise" && !r.text.trim()) return "emptyRevise";
  return null;
}

export function withReview(current: Homework, r: ReviewInput, now: Date): Homework {
  const at = now.toISOString();
  return {
    ...current,
    rev: current.rev + 1,
    status: r.status,
    feedback: {
      at,
      text: r.text.trim().slice(0, HW_FEEDBACK_MAX),
      by: r.by.slice(0, 100),
      status: r.status,
    },
    updatedAt: at,
  };
}

/** Расширение файла ответа по типу: картинка, PDF или видео. */
export const HW_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};
