import { env } from "@/config/env";
import { getSettings, updateSettingAtomic } from "@/core/settings/settings";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { lessonsAccess } from "./access";
import { courseKey, parseCourse, type Course } from "./course";
import { courseToken, courseUrl } from "./link";
import { parseRun, RUN_KEY_PREFIX, runKey } from "./run.server";

/**
 * Сообщение бота о новом уроке (модуль courses). Раз в час крон проходит
 * начатые курсы клиента: если по расписанию открылся урок, о котором
 * покупатель ещё не знает, — одно сообщение со ссылкой на курс. Сколько
 * уроков уже объявлено, хранится в записи прохождения (`notified`), поэтому
 * повторный прогон крона не пишет второй раз.
 *
 * Пишем только покупателям из Telegram: у Instagram и WhatsApp вне
 * 24-часового окна Meta сообщение не дойдёт. Для них урок просто
 * отмечается объявленным — ссылка на курс у покупателя уже есть.
 */
export type LessonAnnouncement = {
  telegramId: number;
  lessonNo: number;
  title: string;
  url: string;
};

type RunRow = { itemId: string; raw: string };

export async function announceNewLessons(
  ctx: TenantContext,
  send: (a: LessonAnnouncement) => Promise<boolean>,
  now = new Date(),
): Promise<{ sent: number; failed: number; silent: number } | { skipped: string }> {
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  if (!ctx.tenant.settings.slug) return { skipped: "no storefront" };
  const { data: rows } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .like("key", `${RUN_KEY_PREFIX}%`);
  const runs: RunRow[] = (rows ?? []).flatMap((r) =>
    r.value && r.key.startsWith(RUN_KEY_PREFIX)
      ? [{ itemId: r.key.slice(RUN_KEY_PREFIX.length), raw: r.value }]
      : [],
  );
  const out = { sent: 0, failed: 0, silent: 0 };
  if (runs.length === 0) return out;

  const { data: items } = await ctx.db
    .from("order_items")
    .select("id, order_id, product_id")
    .in(
      "id",
      runs.map((r) => r.itemId),
    );
  const orderIds = [...new Set((items ?? []).map((i) => i.order_id))];
  const { data: orders } = orderIds.length
    ? await ctx.db.from("orders").select("id, status, platform, telegram_id").in("id", orderIds)
    : { data: [] };
  const productIds = [
    ...new Set((items ?? []).flatMap((i) => (i.product_id ? [i.product_id] : []))),
  ];
  const courseRaw = productIds.length ? await getSettings(ctx, productIds.map(courseKey)) : {};
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const courses = new Map<string, Course>();
  for (const id of productIds) courses.set(id, parseCourse(courseRaw[courseKey(id)]));
  const base = storefrontBase(ctx.tenant, ctx.appUrl);

  for (const r of runs) {
    const run = parseRun(r.raw);
    const item = itemById.get(r.itemId);
    const order = item ? orderById.get(item.order_id) : undefined;
    const course = item?.product_id ? courses.get(item.product_id) : undefined;
    if (!run || !order || order.status !== "delivered" || !course?.lessons.length) continue;
    const open = lessonsAccess(course, run.startedAt, now.getTime()).filter((a) => a.open);
    const knownAt = (c: { startedAt: string; notified?: number }) =>
      // Запись без отметки (начата до этой версии): известны уроки первого дня.
      c.notified ??
      lessonsAccess(course, c.startedAt, Date.parse(c.startedAt)).filter((a) => a.open).length;
    if (open.length <= knownAt(run)) continue;
    const latest = open.at(-1)!;
    // Сначала отметка, потом отправка: сбой записи не должен дать повтор
    // сообщения каждый час. Отметка — сравнением со значением в базе: два
    // параллельных прогона крона не отправят одно сообщение дважды.
    const mark = await updateSettingAtomic(ctx, runKey(r.itemId), (raw) => {
      const cur = parseRun(raw);
      if (!cur || open.length <= knownAt(cur)) return null;
      return JSON.stringify({ ...cur, notified: open.length });
    });
    if (mark === "skipped") continue;
    if (mark === "failed") {
      out.failed++;
      continue;
    }
    if (order.platform !== "telegram" || !order.telegram_id || order.telegram_id <= 0) {
      out.silent++;
      continue;
    }
    const url = courseUrl(base, r.itemId, courseToken(env().SECRETS_KEY, ctx.tenant.id, r.itemId));
    const ok = await send({
      telegramId: order.telegram_id,
      lessonNo: latest.no,
      title: latest.lesson.title,
      url,
    }).catch(() => false);
    if (ok) out.sent++;
    else out.failed++;
  }
  return out;
}
