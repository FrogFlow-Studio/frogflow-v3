import { env } from "@/config/env";
import { orderChatId } from "./order-chat";
import { updateSettingAtomic } from "@/core/settings/settings";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { daytime } from "@/core/winback/winback";
import { courseTimeline, localToInstant } from "./cohort";
import { courseToken, courseUrl } from "./link";
import { liveMark, liveRecordingDue, liveReminderDue, type LiveRemindKind } from "./live-remind";
import { COURSE_KEY_PREFIX, parseCourse } from "./course";
import { readSettings } from "./db.server";
import { pageAll } from "@/core/db/page";
import { parseRun, runKey } from "./run.server";
import { loadRuns } from "./runs.server";

/**
 * Напоминания ученикам об эфирах потока (Ш3): за сутки и за час, а после
 * эфира — «запись готова» (Ш4); только
 * тем, чей доступ действует. Крон каждые 10 минут. «Один раз»: метка пишется
 * в запись прохождения условной записью до отправки, отправляет только
 * выигравший прогон; отправка, которая могла дойти, не повторяется. Пишем
 * покупателям из Telegram: у Instagram и WhatsApp вне окна Meta сообщение не
 * дойдёт, отметка ставится и им, чтобы не копить.
 */
export type LiveReminder = {
  kind: LiveRemindKind;
  telegramId: number;
  course: string;
  title: string;
  /** Начало «YYYY-MM-DDTHH:MM» в поясе магазина. */
  at: string;
  link: string | null;
  /** Страница курса; пусто — у магазина нет адреса витрины. */
  url: string;
};

type Stats = { sent: number; failed: number; silent: number };

/** `course_<uuid товара>`: ровно столько знаков; `_` в LIKE — любой знак, потому и проверка регулярным. */
const COURSE_KEY_LIKE = `${COURSE_KEY_PREFIX}${"_".repeat(8)}-____-____-____-${"_".repeat(12)}`;
const COURSE_KEY_RE = /^course_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Есть ли в записях курсов магазина хоть один эфир потока. Берутся только
 * ключи самих курсов (не записи на каждого ученика: прохождения, сертификаты,
 * приглашения), значения — пакетами по 200 с выходом на первом курсе с эфиром.
 * Сбой чтения — ошибка, а не «эфиров нет».
 */
export async function shopHasLives(ctx: TenantContext): Promise<boolean> {
  const keys = (
    await pageAll<{ key: string }>(
      (from, to) =>
        ctx.db
          .from("app_settings")
          .select("key")
          .like("key", COURSE_KEY_LIKE)
          .order("key")
          .range(from, to),
      "курсы магазина",
    )
  )
    .map((k) => k.key)
    .filter((k) => COURSE_KEY_RE.test(k));
  for (let i = 0; i < keys.length; i += 200) {
    const values = await readSettings(ctx, keys.slice(i, i + 200));
    for (const raw of values.values())
      if ((parseCourse(raw).cohorts ?? []).some((c) => (c.lives?.length ?? 0) > 0)) return true;
  }
  return false;
}

export async function liveReminders(
  ctx: TenantContext,
  send: (r: LiveReminder) => Promise<boolean>,
  now = new Date(),
): Promise<Stats | { skipped: string }> {
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  const out: Stats = { sent: 0, failed: 0, silent: 0 };
  // Крон идёт каждые 10 минут: нет эфиров ни в одном курсе — прохождения не читаем.
  if (!(await shopHasLives(ctx))) return out;
  const runs = (await loadRuns(ctx)).filter((r) => r.order.status === "delivered");
  const base = ctx.tenant.settings.slug ? storefrontBase(ctx.tenant, ctx.appUrl) : null;
  const day = daytime(now, ctx.timezone);

  for (const r of runs) {
    const tl = courseTimeline(
      {
        course: r.course,
        run: r.run,
        boughtAt: r.order.created_at,
        variantId: r.variantId,
      },
      ctx.timezone,
      now,
    );
    if (tl.expired || !tl.cohort?.lives?.length) continue;
    for (const l of tl.cohort.lives) {
      const startMs = localToInstant(l.at, ctx.timezone).getTime();
      const have = new Set(r.run.liveReminded ?? []);
      const marks = {
        day: liveMark(l.id, l.at, "day"),
        hour: liveMark(l.id, l.at, "hour"),
        rec: liveMark(l.id, l.at, "rec"),
      };
      const due = liveReminderDue(startMs, now.getTime(), day, have, marks);
      const recDue = liveRecordingDue(
        Boolean(l.recording),
        Date.parse(r.order.created_at),
        startMs,
        now.getTime(),
        day,
        have,
        marks.rec,
      );
      const todo: Array<{ kind: LiveRemindKind; mark: string[]; link: string | null }> = [];
      if (due)
        todo.push({ kind: due.kind, mark: due.mark, link: due.kind === "hour" ? l.link : null });
      if (recDue) todo.push({ kind: "rec", mark: [marks.rec], link: l.recording ?? null });
      for (const d of todo) {
        // Отметка до отправки; чужой прогон успел раньше — молчим.
        const won =
          (await updateSettingAtomic(ctx, runKey(r.itemId), (raw) => {
            const cur = parseRun(raw);
            if (!cur) return null;
            const taken = new Set(cur.liveReminded ?? []);
            if (taken.has(d.mark.at(-1)!)) return null;
            // Метки эфиров, которых в потоке уже нет, отбрасываем: запись не растёт.
            const alive = new Set(
              (tl.cohort?.lives ?? []).flatMap((x) => [
                liveMark(x.id, x.at, "day"),
                liveMark(x.id, x.at, "hour"),
                liveMark(x.id, x.at, "rec"),
              ]),
            );
            const next = [...[...taken].filter((m) => alive.has(m)), ...d.mark];
            return JSON.stringify({ ...cur, liveReminded: [...new Set(next)] });
          })) === "written";
        if (!won) continue;
        const tg = orderChatId(r.order);
        if (!tg) {
          out.silent++;
          continue;
        }
        const url = base
          ? courseUrl(base, r.itemId, courseToken(env().SECRETS_KEY, ctx.tenant.id, r.itemId))
          : "";
        const ok = await send({
          kind: d.kind,
          telegramId: tg,
          course: r.name,
          title: l.title,
          at: l.at,
          link: d.link,
          url,
        }).catch(() => false);
        if (ok) out.sent++;
        else out.failed++;
      }
    }
  }
  return out;
}
