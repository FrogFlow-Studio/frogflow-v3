import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { servedByV2 } from "@/core/tenant/directory";
import { getSettingStrict } from "@/core/settings/settings";
import { eachPage } from "@/core/db/page";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import { daytime } from "@/core/winback/winback";
import { isLocale, type Locale } from "@/core/i18n/locale";
import { OFFERS_KEY, parseOffers, type LimitedOffer } from "./offers";
import { saleInfoOf } from "./announce";
import { reminderText, saleDay } from "./texts";

/**
 * «Акция кончается завтра»: одно напоминание тем, кому ушло сообщение «Позвать
 * покупателей» (получатели той рассылки со статусом «отправлено», кроме
 * отписавшихся). Идёт за сутки-полтора до конца, только днём по часам магазина и
 * только если звали раньше, чем за сутки: иначе напоминание пришло бы вслед
 * за самой рассылкой. Метка «напомнили» — вставка в app_settings до отправки
 * (два крона одновременно: отправит тот, чья вставка прошла); потолок
 * маркетинга на покупателя тоже действует. Недоставленное не повторяется.
 */
export const offerRemindedKey = (id: string) => `offer_reminded:${id}`;
/**
 * Окно напоминания — последние 36 часов: акция до 23:59 открывает его днём
 * накануне, а не ночью (ночью не пишем), поэтому «завтра» остаётся правдой.
 */
export const REMIND_WINDOW_MS = 36 * 3_600_000;
/** Один прогон не дольше этого: остаток — в отчёт, а не молча. */
export const REMIND_BUDGET_MS = 60_000;
const CHUNK = 200;

export type OfferReminder = { telegramId: number; locale: Locale; text: string };
export type OfferReminderSender = (r: OfferReminder) => Promise<boolean>;

export function reminderDue(o: LimitedOffer, now: Date): boolean {
  if (!o.broadcast_id || !o.announced_at) return false;
  const ends = Date.parse(o.ends_at);
  const t = now.getTime();
  return (
    t < ends &&
    t >= ends - REMIND_WINDOW_MS &&
    Date.parse(o.announced_at) <= ends - REMIND_WINDOW_MS
  );
}

export async function runOfferReminders(
  ctx: TenantContext,
  send: OfferReminderSender,
  now = new Date(),
): Promise<{
  offers: number;
  sent: number;
  failed: number;
  capped: number;
  unfinished: number;
  skipped?: string;
}> {
  const r = { offers: 0, sent: 0, failed: 0, capped: 0, unfinished: 0 };
  if (!ctx.tenant.modules.limited_offers) return { ...r, skipped: "module off" };
  if (!servedByV2(ctx.tenant)) return { ...r, skipped: "not v2" };
  if (!daytime(now, ctx.timezone)) return { ...r, skipped: "night" };
  const due = parseOffers(await getSettingStrict(ctx, OFFERS_KEY)).filter((o) =>
    reminderDue(o, now),
  );
  if (due.length === 0) return r;
  const cap = await loadMarketingCap(ctx);
  const deadline = Date.now() + REMIND_BUDGET_MS;
  for (const offer of due) {
    if (Date.now() > deadline) {
      r.unfinished++;
      continue;
    }
    const mark = await ctx.db
      .from("app_settings")
      .insert({ bot_id: ctx.tenant.id, key: offerRemindedKey(offer.id), value: now.toISOString() });
    if (mark.error) {
      if (mark.error.code === "23505") continue;
      throw serverFailure(`Акция, отметка напоминания: ${mark.error.message}`);
    }
    r.offers++;
    const info = await saleInfoOf(ctx, offer);
    let stop = false;
    await eachPage<{ telegram_id: number }>(
      (from, to) =>
        ctx.db
          .from("broadcast_recipients")
          .select("telegram_id")
          .eq("broadcast_id", offer.broadcast_id!)
          .eq("status", "sent")
          .order("id")
          .range(from, to),
      "напоминание об акции: получатели",
      async (rows) => {
        const ids = [...new Set(rows.map((x) => Number(x.telegram_id)))];
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { data, error } = await ctx.db
            .from("bot_users")
            .select("user_key, telegram_id, state, opt_out")
            .in("telegram_id", ids.slice(i, i + CHUNK))
            .order("user_key");
          if (error) throw serverFailure(`Напоминание об акции: покупатели: ${error.message}`);
          for (const u of data ?? []) {
            if (u.opt_out) continue;
            if (Date.now() > deadline) {
              r.unfinished++;
              stop = true;
              continue;
            }
            const state = await claimMarketing(ctx, u.user_key, u.state, cap, now);
            if (!state) {
              r.capped++;
              continue;
            }
            const locale = isLocale(state.locale) ? state.locale : "ru";
            const ok = await send({
              telegramId: Number(u.telegram_id),
              locale,
              text: reminderText(info, locale, saleDay(offer.ends_at, now, ctx.timezone)),
            });
            if (ok) r.sent++;
            else r.failed++;
          }
        }
        return !stop;
      },
    );
  }
  return r;
}
