import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { updateSettingStamped } from "@/core/settings/settings";
import { COHORTS_MAX, nextCohortAfter, type Cohort, type NextCohort } from "./cohort";
import { serverFailure } from "@/lib/server-failure";
import { COURSE_MARKER_URL } from "./marker";
import {
  courseFilePaths,
  courseKey,
  courseProblem,
  hasCourseContent,
  LESSON_FILES_MAX,
  LESSONS_MAX,
  parseCourse,
  type Course,
  type CourseProblem,
} from "./course";
import { readSetting } from "./db.server";
import type { LessonQuiz } from "./lesson-quiz";

/**
 * Уроки курса в админке продавца: прочитать и сохранить. Курс привязан к
 * товару этого клиента; права арендатора (ctx.db) не дадут прочитать чужой
 * товар, а файлы проверяет courseProblem.
 */
export async function getCourse(ctx: TenantContext, productId: string): Promise<Course> {
  return parseCourse(await readSetting(ctx, courseKey(productId)));
}

const cleanQuiz = (q: LessonQuiz): LessonQuiz => ({
  pass: q.pass,
  questions: q.questions.map((x) => ({
    text: x.text.trim(),
    options: x.options.map((o) => o.trim()),
    correct: [...new Set(x.correct)].sort((a, b) => a - b),
  })),
});

/** Отказ продавцу; номер урока — с единицы, как он видит список. */
function problemError(p: CourseProblem): UserError {
  switch (p.kind) {
    case "tooMany":
      return new UserError("err.course.tooMany", "В курсе не больше {max} уроков.", {
        max: LESSONS_MAX,
      });
    case "noTitle":
      return new UserError("err.course.noTitle", "У урока {lesson} нет названия.", {
        lesson: p.lesson,
      });
    case "badLink":
      return new UserError(
        "err.course.badLink",
        "Ссылка в уроке {lesson} должна начинаться с https://.",
        { lesson: p.lesson },
      );
    case "tooManyFiles":
      return new UserError("err.course.tooManyFiles", "В уроке {lesson} не больше {max} файлов.", {
        lesson: p.lesson,
        max: LESSON_FILES_MAX,
      });
    case "empty":
      return new UserError(
        "err.course.emptyLesson",
        "Урок {lesson} пустой: добавьте текст, файл или ссылку.",
        { lesson: p.lesson },
      );
    case "badQuiz":
      return new UserError(
        "err.course.badQuiz",
        "Тест в уроке {lesson}, вопрос {question}: нужен текст, 2–6 вариантов и хотя бы один верный; порог — 1–100 %.",
        { lesson: p.lesson, question: p.question },
      );
    case "badSchedule":
      return new UserError("err.course.badSchedule", "Уроки можно открывать раз в 1–60 дней.");
    case "badCohort":
      return new UserError(
        "err.course.badCohort",
        "Поток {cohort}: укажите дату и время старта; последний день набора — датой.",
        { cohort: p.cohort },
      );
    case "badTariff":
      return new UserError("err.course.badTariff", "Срок доступа тарифа — от 1 до 3650 дней.");
    case "badChannel":
      return new UserError(
        "err.course.badChannel",
        "Канал курса: id вида -1001234567890 или @имя_канала.",
      );
    case "duplicateId":
    case "foreignFile":
      return new UserError(
        "err.course.badLesson",
        "Урок {lesson} повреждён — удалите его и добавьте заново.",
        { lesson: p.lesson },
      );
  }
}

export async function saveCourse(
  ctx: TenantContext,
  productId: string,
  course: Course,
): Promise<void> {
  const { data: product, error: productError } = await ctx.db
    .from("products")
    .select("id, fulfillment_kind, file_url")
    .eq("id", productId)
    .maybeSingle();
  if (productError) throw serverFailure(`Товар не прочитан: ${productError.message}`);
  if (!product) throw new UserError("err.course.noProduct", "Товар не найден.");
  if (product.fulfillment_kind === "physical")
    throw new UserError(
      "err.course.physical",
      "Курс можно сделать только из цифрового товара, не из физического.",
    );
  const problem = courseProblem(ctx.tenant.id, course);
  if (problem) throw problemError(problem);
  const clean: Course = {
    schedule: course.schedule,
    lessons: course.lessons.map((l) => ({
      id: l.id,
      title: l.title.trim(),
      text: l.text.trim(),
      files: l.files.map((f) => ({ path: f.path, name: f.name?.trim() || null })),
      link: l.link?.trim() || null,
      ...(l.homework?.trim() ? { homework: l.homework.trim() } : {}),
      ...(l.preview ? { preview: true } : {}),
      ...(l.quiz ? { quiz: cleanQuiz(l.quiz) } : {}),
    })),
    ...(course.channel?.trim() ? { channel: course.channel.trim() } : {}),
    ...(course.cohorts?.length
      ? {
          cohorts: course.cohorts.map((c) => ({
            id: c.id,
            title: c.title.trim(),
            start: c.start,
            enrollUntil: c.enrollUntil || null,
            ...(c.chat?.trim() ? { chat: c.chat.trim() } : {}),
          })),
        }
      : {}),
    ...(course.homeworkDays ? { homeworkDays: course.homeworkDays } : {}),
    ...(course.tutor ? { tutor: true } : {}),
    ...(course.tariffs && Object.keys(course.tariffs).length
      ? { tariffs: await ownVariantTariffs(ctx, productId, course.tariffs) }
      : {}),
  };
  // Эфиры пишутся своими функциями (core/courses/lives.server), форма их не
  // присылает: берём записанные из той же версии записи, что и заменяем.
  let written: Course = clean;
  const r = await updateSettingStamped(ctx, courseKey(productId), (raw) => {
    const stored = new Map((parseCourse(raw).cohorts ?? []).map((c) => [c.id, c.lives]));
    const cohorts = clean.cohorts?.map((c) => {
      const lives = stored.get(c.id);
      return lives?.length ? { ...c, lives } : c;
    });
    written = cohorts ? { ...clean, cohorts } : clean;
    return JSON.stringify(written);
  });
  if (r !== "written")
    throw new UserError(
      "err.settings.saveFailed",
      "Настройка не сохранилась. Попробуйте ещё раз; если повторится — напишите в поддержку.",
    );
  await syncCourseMarker(ctx, productId, product.file_url, hasCourseContent(written));
}

/**
 * «Создать следующий поток»: копия последнего потока со сдвигом на выбранный
 * день (core/courses/cohort). Читает и пишет запись курса одной условной
 * записью по метке `updated_at`, а не по всему jsonb (он может быть длинным):
 * параллельное сохранение курса не потеряется, а повтор не создаст два потока.
 * Остальные поля записи (уроки, тарифы, неизвестные) не трогаются.
 */
export async function createNextCohort(
  ctx: TenantContext,
  productId: string,
  startDay: string,
): Promise<Cohort> {
  let created: Cohort | null = null;
  let refused: Extract<NextCohort, { ok: false }>["reason"] | null = null;
  const r = await updateSettingStamped(ctx, courseKey(productId), (raw) => {
    const course = parseCourse(raw);
    const next = nextCohortAfter(course.cohorts ?? [], startDay, ctx.timezone, crypto.randomUUID());
    if (!next.ok) {
      refused = next.reason;
      return null;
    }
    created = next.cohort;
    const obj = (JSON.parse(raw ?? "{}") as Record<string, unknown>) ?? {};
    const own = Array.isArray(obj.cohorts) ? obj.cohorts : [];
    return JSON.stringify({ ...obj, cohorts: [...own, next.cohort] });
  });
  if (refused) throw cohortRefusal(refused);
  if (r !== "written" || !created)
    throw serverFailure("Следующий поток не записан: курс менялся параллельно");
  return created;
}

function cohortRefusal(reason: "noCohorts" | "badDay" | "notLater" | "tooMany"): UserError {
  switch (reason) {
    case "noCohorts":
      return new UserError(
        "err.course.nextNoCohorts",
        "Сначала создайте и сохраните хотя бы один поток: следующий — его копия.",
      );
    case "badDay":
      return new UserError("err.course.nextBadDay", "Выберите дату старта следующего потока.");
    case "notLater":
      return new UserError(
        "err.course.nextNotLater",
        "Старт следующего потока должен быть позже старта последнего.",
      );
    case "tooMany":
      return new UserError("err.course.nextTooMany", "В курсе не больше {max} потоков.", {
        max: COHORTS_MAX,
      });
  }
}

/** Тарифы только для вариантов этого товара: чужой id из запроса отбрасывается. */
async function ownVariantTariffs(
  ctx: TenantContext,
  productId: string,
  tariffs: NonNullable<Course["tariffs"]>,
): Promise<NonNullable<Course["tariffs"]>> {
  const { data, error } = await ctx.db
    .from("product_variants")
    .select("id")
    .eq("product_id", productId);
  if (error) throw serverFailure(`Варианты товара не прочитаны: ${error.message}`);
  const own = new Set((data ?? []).map((v) => v.id));
  return Object.fromEntries(Object.entries(tariffs).filter(([id]) => own.has(id)));
}

/**
 * Метка товара-курса (core/courses/marker): с уроками товар продаётся и без
 * файлов, без уроков — снова только с файлами (выдать было бы нечего).
 * Чужую ссылку v1 в file_url не трогаем: условие записи — пусто или метка.
 */
export async function syncCourseMarker(
  ctx: TenantContext,
  productId: string,
  fileUrl: string | null,
  hasContent: boolean,
) {
  if (hasContent && !fileUrl) {
    const { error } = await ctx.db
      .from("products")
      .update({ file_url: COURSE_MARKER_URL })
      .eq("id", productId)
      .is("file_url", null);
    if (error) throw serverFailure(`Курс сохранён, но товар не отмечен курсом: ${error.message}`);
  } else if (!hasContent && fileUrl === COURSE_MARKER_URL) {
    const { error } = await ctx.db
      .from("products")
      .update({ file_url: null })
      .eq("id", productId)
      .eq("file_url", COURSE_MARKER_URL);
    if (error) throw serverFailure(`Метка курса не снята: ${error.message}`);
  }
}

/** Курс товара, который удаляют: запись убрать, файлы вернуть на удаление из бакета. */
export async function dropCourse(ctx: TenantContext, productId: string): Promise<string[]> {
  const key = courseKey(productId);
  const raw = await readSetting(ctx, key);
  if (raw == null) return [];
  const { error } = await ctx.db.from("app_settings").delete().eq("key", key);
  if (error) throw serverFailure(`Курс товара не удалён: ${error.message}`);
  return courseFilePaths(parseCourse(raw));
}
