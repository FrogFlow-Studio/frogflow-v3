import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { setSetting } from "@/core/settings/settings";
import { serverFailure } from "@/lib/server-failure";
import { COURSE_MARKER_URL } from "./marker";
import {
  courseFilePaths,
  courseKey,
  courseProblem,
  LESSON_FILES_MAX,
  LESSONS_MAX,
  parseCourse,
  type Course,
  type CourseProblem,
} from "./course";
import { readSetting } from "./db.server";

/**
 * Уроки курса в админке продавца: прочитать и сохранить. Курс привязан к
 * товару этого клиента; права арендатора (ctx.db) не дадут прочитать чужой
 * товар, а файлы проверяет courseProblem.
 */
export async function getCourse(ctx: TenantContext, productId: string): Promise<Course> {
  return parseCourse(await readSetting(ctx, courseKey(productId)));
}

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
    ...(course.tariffs && Object.keys(course.tariffs).length
      ? { tariffs: await ownVariantTariffs(ctx, productId, course.tariffs) }
      : {}),
  };
  await setSetting(ctx, courseKey(productId), JSON.stringify(clean));
  await syncCourseMarker(ctx, productId, product.file_url, clean.lessons.length > 0);
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
async function syncCourseMarker(
  ctx: TenantContext,
  productId: string,
  fileUrl: string | null,
  hasLessons: boolean,
) {
  if (hasLessons && !fileUrl) {
    const { error } = await ctx.db
      .from("products")
      .update({ file_url: COURSE_MARKER_URL })
      .eq("id", productId)
      .is("file_url", null);
    if (error) throw serverFailure(`Курс сохранён, но товар не отмечен курсом: ${error.message}`);
  } else if (!hasLessons && fileUrl === COURSE_MARKER_URL) {
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
