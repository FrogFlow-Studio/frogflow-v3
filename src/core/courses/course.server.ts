import type { TenantContext } from "@/core/tenant/resolve.server";
import { UserError } from "@/core/i18n/user-error";
import { getSetting, setSetting } from "@/core/settings/settings";
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

/**
 * Уроки курса в админке продавца: прочитать и сохранить. Курс привязан к
 * товару этого клиента; права арендатора (ctx.db) не дадут прочитать чужой
 * товар, а файлы проверяет courseProblem.
 */
export async function getCourse(ctx: TenantContext, productId: string): Promise<Course> {
  return parseCourse(await getSetting(ctx, courseKey(productId)));
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
  const { data: product } = await ctx.db
    .from("products")
    .select("id, fulfillment_kind")
    .eq("id", productId)
    .maybeSingle();
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
    })),
  };
  await setSetting(ctx, courseKey(productId), JSON.stringify(clean));
}

/** Курс товара, который удаляют: запись убрать, файлы вернуть на удаление из бакета. */
export async function dropCourse(ctx: TenantContext, productId: string): Promise<string[]> {
  const key = courseKey(productId);
  const raw = await getSetting(ctx, key);
  if (raw == null) return [];
  await ctx.db.from("app_settings").delete().eq("key", key);
  return courseFilePaths(parseCourse(raw));
}
