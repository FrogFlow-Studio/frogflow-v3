import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting } from "@/core/settings/settings";
import { enrollOpen } from "./cohort";
import { courseKey, parseCourse } from "./course";

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
  const course = parseCourse(await getSetting(ctx, courseKey(productId)));
  return course.lessons.length === 0 || enrollOpen(course, now, ctx.timezone);
}
