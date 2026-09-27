import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { isLocale } from "@/core/i18n/locale";
import { getSetting } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import { stateFromJson } from "@/core/customers/customers";
import { claimMarketing, loadMarketingCap, marketingAllowed } from "@/core/marketing/cap";
import { parseReminderHours, shouldSendCartReminder } from "./pure";

export type CartReminderTarget = { telegramId: number; locale: Locale; items: number };

/**
 * Возврат брошенной корзины. Раз в полчаса крон ищет покупателей, у которых
 * товары лежат дольше порога `cart_reminder_hours` (по умолчанию 6) и кому
 * про эту корзину ещё не напоминали. cart_items не хранит updated_at,
 * поэтому активность — MAX(created_at) позиций корзины.
 *
 * Захват — CAS на bot_users.cart_reminder_sent_at до отправки: параллельный
 * запуск крона не напомнит дважды. Отправка — лучшее старание.
 */
export async function sendCartReminders(
  ctx: TenantContext,
  send: (target: CartReminderTarget) => Promise<boolean>,
  now = new Date(),
): Promise<{ checked: number; sent: number; hours: number }> {
  if (!ctx.tenant.modules.cart_reminder) return { checked: 0, sent: 0, hours: 0 };
  const hours = parseReminderHours(await getSetting(ctx, "cart_reminder_hours"));
  if (hours <= 0) return { checked: 0, sent: 0, hours };
  const cap = await loadMarketingCap(ctx);

  const items = await pageAll(
    (from, to) =>
      ctx.db
        .from("cart_items")
        .select("telegram_id, created_at")
        .order("created_at", { ascending: false })
        .range(from, to),
    "корзины для напоминания",
  );
  const last = new Map<number, { at: string; n: number }>();
  for (const it of items) {
    const id = Number(it.telegram_id);
    const cur = last.get(id);
    if (cur) cur.n++;
    else last.set(id, { at: it.created_at, n: 1 });
  }

  let sent = 0;
  for (const [telegramId, { at, n }] of last) {
    if (!(telegramId > 0)) continue;
    const cutoff = new Date(at);
    if (now.getTime() - cutoff.getTime() < hours * 3600_000) continue;

    const { data: user } = await ctx.db
      .from("bot_users")
      .select("user_key, cart_reminder_sent_at, state, platform, opt_out")
      .eq("telegram_id", telegramId)
      .eq("platform", "telegram")
      .maybeSingle();
    if (!user || user.opt_out) continue;
    const eligible = shouldSendCartReminder(
      cutoff,
      now,
      hours,
      user.cart_reminder_sent_at ? new Date(user.cart_reminder_sent_at) : null,
    );
    if (!eligible) continue;
    // Потолок маркетинговых сообщений за сутки (core/marketing/cap): место занято —
    // корзину не отмечаем, напомним в следующий прогон, когда оно освободится.
    const state = stateFromJson(user.state);
    if (!marketingAllowed(state, cap, now)) continue;

    // .is() сравнивает с NULL, .eq() — с прошлым значением; не взаимозаменяемы.
    const cas = ctx.db
      .from("bot_users")
      .update({ cart_reminder_sent_at: now.toISOString() })
      .eq("telegram_id", telegramId)
      .eq("platform", "telegram");
    const { data: claimed } = await (
      user.cart_reminder_sent_at
        ? cas.eq("cart_reminder_sent_at", user.cart_reminder_sent_at)
        : cas.is("cart_reminder_sent_at", null)
    )
      .select("telegram_id")
      .maybeSingle();
    if (!claimed) continue;
    if (!(await claimMarketing(ctx, user.user_key, user.state, cap, now))) {
      // Место за сутки ушло другому сообщению (или state успел измениться):
      // возвращаем отметку корзины как была, иначе напоминание пропадёт насовсем.
      const back = ctx.db
        .from("bot_users")
        .update({ cart_reminder_sent_at: user.cart_reminder_sent_at })
        .eq("telegram_id", telegramId)
        .eq("platform", "telegram")
        .eq("cart_reminder_sent_at", now.toISOString());
      const { error } = await back;
      if (error) console.error(`[cart-reminder:${ctx.tenant.id}] ${telegramId}: ${error.message}`);
      continue;
    }

    const locale: Locale = isLocale(state.locale)
      ? state.locale
      : (ctx.tenant.settings.default_locale ?? "ru");
    try {
      if (await send({ telegramId, locale, items: n })) sent++;
    } catch (e) {
      console.error(`[cart-reminder:${ctx.tenant.id}] ${telegramId}`, e);
    }
  }
  return { checked: last.size, sent, hours };
}
