import { env } from "@/config/env";
import { updateSettingAtomic } from "@/core/settings/settings";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { lessonsAccess } from "./access";
import { courseTimeline } from "./cohort";
import { courseToken, courseUrl } from "./link";
import { parseRun, runKey } from "./run.server";
import { loadRuns } from "./runs.server";

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

export async function announceNewLessons(
  ctx: TenantContext,
  send: (a: LessonAnnouncement) => Promise<boolean>,
  now = new Date(),
): Promise<{ sent: number; failed: number; silent: number } | { skipped: string }> {
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  if (!ctx.tenant.settings.slug) return { skipped: "no storefront" };
  const out = { sent: 0, failed: 0, silent: 0 };
  const runs = await loadRuns(ctx);
  if (runs.length === 0) return out;
  const base = storefrontBase(ctx.tenant, ctx.appUrl);

  for (const r of runs) {
    const { run, order, course } = r;
    if (order.status !== "delivered") continue;
    // Календарь покупки: поток (старт для всех один), тариф, конец доступа.
    const open = courseTimeline(
      { course, run, boughtAt: order.created_at, variantId: r.variantId },
      ctx.timezone,
      now,
    ).access.filter((a) => a.open);
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
