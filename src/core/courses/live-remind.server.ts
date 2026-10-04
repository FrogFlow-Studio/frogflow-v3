import { env } from "@/config/env";
import { updateSettingAtomic } from "@/core/settings/settings";
import { storefrontBase } from "@/core/tenant/custom-domain";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { daytime } from "@/core/winback/winback";
import { courseTimeline, localToInstant } from "./cohort";
import { courseToken, courseUrl } from "./link";
import { liveMark, liveReminderDue, type LiveRemindKind } from "./live-remind";
import { parseRun, runKey } from "./run.server";
import { loadRuns } from "./runs.server";

/**
 * Напоминания ученикам об эфирах потока (Ш3): за сутки и за час, только
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

export async function liveReminders(
  ctx: TenantContext,
  send: (r: LiveReminder) => Promise<boolean>,
  now = new Date(),
): Promise<Stats | { skipped: string }> {
  if (!ctx.tenant.modules.courses) return { skipped: "module off" };
  const out: Stats = { sent: 0, failed: 0, silent: 0 };
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
      const marks = { day: liveMark(l.id, l.at, "day"), hour: liveMark(l.id, l.at, "hour") };
      const due = liveReminderDue(
        localToInstant(l.at, ctx.timezone).getTime(),
        now.getTime(),
        day,
        new Set(r.run.liveReminded ?? []),
        marks,
      );
      if (!due) continue;
      // Отметка до отправки; чужой прогон успел раньше — молчим.
      const won =
        (await updateSettingAtomic(ctx, runKey(r.itemId), (raw) => {
          const cur = parseRun(raw);
          if (!cur) return null;
          const have = new Set(cur.liveReminded ?? []);
          if (have.has(due.mark.at(-1)!)) return null;
          // Метки эфиров, которых в потоке уже нет, отбрасываем: запись не растёт.
          const alive = new Set(
            (tl.cohort?.lives ?? []).flatMap((x) => [
              liveMark(x.id, x.at, "day"),
              liveMark(x.id, x.at, "hour"),
            ]),
          );
          const next = [...[...have].filter((m) => alive.has(m)), ...due.mark];
          return JSON.stringify({ ...cur, liveReminded: [...new Set(next)] });
        })) === "written";
      if (!won) continue;
      const tg =
        r.order.platform === "telegram" && Number(r.order.telegram_id) > 0
          ? Number(r.order.telegram_id)
          : null;
      if (!tg) {
        out.silent++;
        continue;
      }
      const url = base
        ? courseUrl(base, r.itemId, courseToken(env().SECRETS_KEY, ctx.tenant.id, r.itemId))
        : "";
      const ok = await send({
        kind: due.kind,
        telegramId: tg,
        course: r.name,
        title: l.title,
        at: l.at,
        link: due.kind === "hour" ? l.link : null,
        url,
      }).catch(() => false);
      if (ok) out.sent++;
      else out.failed++;
    }
  }
  return out;
}
