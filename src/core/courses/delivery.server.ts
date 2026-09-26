import { env } from "@/config/env";
import type { MaterialSnapshot } from "@/core/catalog/materials";
import { getSetting } from "@/core/settings/settings";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, parseCourse } from "./course";
import { courseToken, courseUrl } from "./link";

/** Подпись ссылки на уроки в сообщении о выдаче. */
export const COURSE_LINK_NAME = "Уроки курса";

/**
 * Ссылка на курс как ещё один материал позиции: канал отправляет её тем же
 * путём, что и внешние ссылки товара (Telegram — сообщением, Direct и
 * WhatsApp — строкой). Пусто, если модуль выключен, у товара нет уроков
 * или у магазина нет адреса витрины (slug).
 */
export async function courseMaterials(
  ctx: TenantContext,
  item: { id: string; product_id: string | null },
): Promise<MaterialSnapshot[]> {
  if (!ctx.tenant.modules.courses || !item.product_id || !ctx.tenant.settings.slug) return [];
  const course = parseCourse(await getSetting(ctx, courseKey(item.product_id)));
  if (course.lessons.length === 0) return [];
  const token = courseToken(env().SECRETS_KEY, ctx.tenant.id, item.id);
  const url = courseUrl(storefrontBase(ctx.tenant, ctx.appUrl), item.id, token);
  return [{ path: null, name: COURSE_LINK_NAME, url }];
}
