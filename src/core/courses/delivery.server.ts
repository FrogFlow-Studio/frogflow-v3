import { env } from "@/config/env";
import type { MaterialSnapshot } from "@/core/catalog/materials";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, parseCourse } from "./course";
import { courseToken, courseUrl } from "./link";
import { readSetting } from "./db.server";

/** Подпись ссылки на уроки в сообщении о выдаче. */
export const COURSE_LINK_NAME = "Уроки курса";
/** Подпись ссылки в закрытый канал: ведёт на страницу курса, та выдаёт личное приглашение. */
export const COURSE_CHANNEL_LINK_NAME = "Вступить в закрытый канал курса";

/**
 * Ссылка на курс (и, если у курса есть закрытый канал, — на вступление)
 * как ещё один материал позиции: канал отправляет её тем же
 * путём, что и внешние ссылки товара (Telegram — сообщением, Direct и
 * WhatsApp — строкой). Пусто, если модуль выключен, у товара нет уроков
 * или у магазина нет адреса витрины (slug).
 */
export async function courseMaterials(
  ctx: TenantContext,
  item: { id: string; product_id: string | null },
): Promise<MaterialSnapshot[]> {
  if (!ctx.tenant.modules.courses || !item.product_id || !ctx.tenant.settings.slug) return [];
  const course = parseCourse(await readSetting(ctx, courseKey(item.product_id)));
  if (course.lessons.length === 0) return [];
  const token = courseToken(env().SECRETS_KEY, ctx.tenant.id, item.id);
  const url = courseUrl(storefrontBase(ctx.tenant, ctx.appUrl), item.id, token);
  // Канал — через страницу курса (`join=1`): приглашение личное и одно на
  // покупку, его выпускает страница в момент перехода, а не выдача заранее.
  return [
    { path: null, name: COURSE_LINK_NAME, url },
    ...(course.channel
      ? [{ path: null, name: COURSE_CHANNEL_LINK_NAME, url: `${url}&join=1` }]
      : []),
  ];
}
