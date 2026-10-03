import { env } from "@/config/env";
import { updateSettingAtomic } from "@/core/settings/settings";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { CHAT_SLOT, revokeItemChannel, type ChannelAccess } from "./channel.server";
import { courseTimeline } from "./cohort";
import { readSettings } from "./db.server";
import { hwKey, parseHomework } from "./homework";
import { courseToken, courseUrl } from "./link";
import { parseRun, runKey, type CourseRun } from "./run.server";
import { loadRuns } from "./runs.server";

/**
 * Напоминания курса (крон раз в час, вместе с объявлением уроков):
 *
 * - до старта потока — за 3 дня и за день (купившим раньше этих отметок);
 * - несданное задание — когда прошёл срок сдачи (Course.homeworkDays) после
 *   открытия урока, один раз на урок, только в тарифе с проверкой;
 * - конец доступа по тарифу — исключение из закрытого канала курса.
 *
 * «Один раз» — условная запись отметки в запись прохождения до отправки.
 * Пишем только покупателям из Telegram: у Instagram и WhatsApp вне окна
 * Meta сообщение не дойдёт; отметка ставится и им, чтобы не копить.
 */
export type CourseReminder =
  | { kind: "pre"; telegramId: number; course: string; days: number; start: string; url: string }
  | {
      kind: "homework";
      telegramId: number;
      course: string;
      lessonNo: number;
      title: string;
      url: string;
    };

export const PRE_START_DAYS = [3, 1] as const;
const DAY = 86_400_000;

type Stats = { sent: number; failed: number; silent: number; accessEnded: number };

export async function courseReminders(
  ctx: TenantContext,
  send: (r: CourseReminder) => Promise<boolean>,
  access: ChannelAccess | null,
  now = new Date(),
): Promise<Stats | { skipped: string }> {
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  const out: Stats = { sent: 0, failed: 0, silent: 0, accessEnded: 0 };
  const runs = (await loadRuns(ctx)).filter((r) => r.order.status === "delivered");
  if (runs.length === 0) return out;
  const base = ctx.tenant.settings.slug ? storefrontBase(ctx.tenant, ctx.appUrl) : null;
  const url = (itemId: string) =>
    base ? courseUrl(base, itemId, courseToken(env().SECRETS_KEY, ctx.tenant.id, itemId)) : "";

  // Кандидаты на «не сдано»: открытые уроки с заданием, чей срок прошёл.
  const due: Array<{ itemId: string; lessonId: string; no: number; title: string }> = [];
  const timelines = new Map<string, ReturnType<typeof courseTimeline>>();
  for (const r of runs) {
    const tl = courseTimeline(
      { course: r.course, run: r.run, boughtAt: r.order.created_at, variantId: r.variantId },
      ctx.timezone,
      now,
    );
    timelines.set(r.itemId, tl);
    const days = r.course.homeworkDays;
    if (!days || !tl.tariff.homework || tl.expired) continue;
    for (const a of tl.access)
      if (
        a.open &&
        a.lesson.homework &&
        Date.parse(a.opensAt) + days * DAY <= now.getTime() &&
        !(r.run.hwReminded ?? []).includes(a.lesson.id)
      )
        due.push({ itemId: r.itemId, lessonId: a.lesson.id, no: a.no, title: a.lesson.title });
  }
  const submitted = due.length
    ? await readSettings(
        ctx,
        due.map((d) => hwKey(d.itemId, d.lessonId)),
      )
    : new Map<string, string>();

  const telegramOf = (r: (typeof runs)[number]) =>
    r.order.platform === "telegram" && Number(r.order.telegram_id) > 0
      ? Number(r.order.telegram_id)
      : null;
  /** Отметка до отправки; false — уже отмечено (другим прогоном) или сбой. */
  const mark = async (itemId: string, change: (run: CourseRun) => CourseRun | null) =>
    (await updateSettingAtomic(ctx, runKey(itemId), (raw) => {
      const cur = parseRun(raw);
      const next = cur ? change(cur) : null;
      return next ? JSON.stringify(next) : null;
    })) === "written";
  const deliver = async (r: (typeof runs)[number], msg: CourseReminder | null) => {
    if (!msg) {
      out.silent++;
      return;
    }
    if (await send(msg).catch(() => false)) out.sent++;
    else out.failed++;
  };

  for (const r of runs) {
    const tl = timelines.get(r.itemId)!;
    const tg = telegramOf(r);

    // До старта потока: одно сообщение на ближайшую отметку (3 дня, 1 день).
    if (tl.cohort && tl.beforeStart) {
      const left = (Date.parse(tl.start) - now.getTime()) / DAY;
      const hit = PRE_START_DAYS.filter((d) => left <= d);
      const fresh = hit.filter((d) => !(r.run.pre ?? []).includes(d));
      if (fresh.length) {
        const ok = await mark(r.itemId, (cur) => {
          const have = cur.pre ?? [];
          if (hit.every((d) => have.includes(d))) return null;
          return { ...cur, pre: [...new Set([...have, ...hit])] };
        });
        if (ok)
          await deliver(
            r,
            tg
              ? {
                  kind: "pre",
                  telegramId: tg,
                  course: r.name,
                  days: Math.max(1, Math.ceil(left)),
                  start: tl.start,
                  url: url(r.itemId),
                }
              : null,
          );
      }
    }

    // Несданные задания после срока.
    for (const d of due.filter((x) => x.itemId === r.itemId)) {
      if (parseHomework(submitted.get(hwKey(d.itemId, d.lessonId)))) continue;
      const ok = await mark(r.itemId, (cur) =>
        (cur.hwReminded ?? []).includes(d.lessonId)
          ? null
          : { ...cur, hwReminded: [...(cur.hwReminded ?? []), d.lessonId] },
      );
      if (ok)
        await deliver(
          r,
          tg
            ? {
                kind: "homework",
                telegramId: tg,
                course: r.name,
                lessonNo: d.no,
                title: d.title,
                url: url(r.itemId),
              }
            : null,
        );
    }

    // Конец доступа по тарифу: закрытый канал — только пока доступ открыт.
    const chat = tl.cohort?.chat ?? null;
    if (tl.expired && (r.course.channel || chat) && access && !r.run.accessEnded) {
      // Срок перечитываем из свежей записи: продавец мог продлить доступ, пока шёл прогон.
      const ok = await mark(r.itemId, (cur) =>
        cur.accessEnded ||
        !courseTimeline(
          { course: r.course, run: cur, boughtAt: r.order.created_at, variantId: r.variantId },
          ctx.timezone,
          now,
        ).expired
          ? null
          : { ...cur, accessEnded: now.toISOString() },
      );
      if (ok) {
        if (r.course.channel)
          await revokeItemChannel(ctx, r.itemId, r.course.channel, r.order, access, now);
        if (chat) await revokeItemChannel(ctx, r.itemId, chat, r.order, access, now, CHAT_SLOT);
        out.accessEnded++;
      }
    }
  }
  return out;
}
