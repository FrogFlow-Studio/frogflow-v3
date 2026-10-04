import type { TenantContext } from "@/core/tenant/resolve.server";
import { enrollOpen } from "./cohort";
import { courseKey, hasCourseContent, parseCourse } from "./course";
import { readSetting } from "./db.server";

/**
 * Идёт ли набор на курс (модуль courses): у курса с потоками — пока не
 * кончился набор хотя бы в один. Закрытый набор — товар не кладётся в
 * корзину ни в боте, ни в Direct, ни на сайте (все идут через addToCart).
 */
export async function courseEnrollOpen(
  ctx: TenantContext,
  productId: string,
  now = new Date(),
): Promise<boolean> {
  if (!ctx.tenant.modules.courses) return true;
  const course = parseCourse(await readSetting(ctx, courseKey(productId)));
  return !hasCourseContent(course) || enrollOpen(course, now, ctx.timezone);
}
