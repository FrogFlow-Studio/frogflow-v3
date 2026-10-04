import type { TenantContext } from "@/core/tenant/resolve.server";
import { recordAutoMessage } from "@/core/automsg/stats";
import type { Locale } from "@/core/i18n/locale";
import { isLocale } from "@/core/i18n/locale";
import { getSetting } from "@/core/settings/settings";
import { pageAll } from "@/core/db/page";
import {
  blockedAmong,
  customerFromRow,
  stateFromJson,
  type Customer,
} from "@/core/customers/customers";
import type { Platform } from "@/core/customers/customers";
import { listCart, priceCart } from "@/core/cart/cart";
import { lastInboundAt } from "@/core/chat/chat";
import { replyWindow } from "@/core/chat/reply-window";
import { inStock } from "@/core/waitlist/waitlist";
import { serverFailure } from "@/lib/server-failure";
import { claimMarketing, loadMarketingCap, marketingAllowed } from "@/core/marketing/cap";
import { parseReminderHours, shouldSendCartReminder } from "./pure";

/** Сколько позиций называет напоминание; остальные — «и ещё N». */
export const REMINDER_ITEMS_SHOWN = 3;

export type CartReminderTarget = {
  telegramId: number;
  locale: Locale;
  /** Всего позиций в корзине. */
  items: number;
  customer: Customer;
  /** До трёх доступных позиций по порядку добавления. */
  lines: { name: string; quantity: number }[];
  /** Сколько доступных позиций не вошло в `lines`. */
  more: number;
  /** Сумма доступных позиций по текущим ценам; null — валюты разные, сумму не сложить. */
  total: { amount: number; currency: string } | null;
};

/**
 * Что назвать в напоминании: доступные сейчас позиции (товар есть, включён и
 * не закончился) по текущим ценам. Недоступные не упоминаем; недоступна вся
 * корзина — null, напоминания нет.
 */
export async function cartReminderSummary(
  ctx: TenantContext,
  customer: Customer,
): Promise<Pick<CartReminderTarget, "lines" | "more" | "total"> | null> {
  const items = (await listCart(ctx, customer)).filter((it) => it.products && inStock(it.products));
  if (!items.length) return null;
  const priced = await priceCart(ctx, items, customer.state.country_code ?? null);
  const lines = priced.lines.map((l) => ({ name: l.name, quantity: Number(l.item.quantity) }));
  if (!lines.length) return null;
  return {
    lines: lines.slice(0, REMINDER_ITEMS_SHOWN),
    more: Math.max(0, lines.length - REMINDER_ITEMS_SHOWN),
    total: priced.mixedCurrency ? null : { amount: priced.total, currency: priced.currency },
  };
}

/**
 * Возврат брошенной корзины. Раз в полчаса крон ищет покупателей, у которых
 * товары лежат дольше порога `cart_reminder_hours` (по умолчанию 6) и кому
 * про эту корзину ещё не напоминали. cart_items не хранит updated_at,
 * поэтому активность — MAX(created_at) позиций корзины.
 *
 * Захват — CAS на bot_users.cart_reminder_sent_at до отправки: параллельный
 * запуск крона не напомнит дважды. Отправка — лучшее старание, неудачную (в том
 * числе оборвавшуюся: могла дойти) не повторяем.
 *
 * Telegram — всегда; Instagram и WhatsApp — только пока открыто окно ответа
 * 24 часа от последнего входящего сообщения (core/chat/reply-window), иначе
 * Meta откажет, а отметка корзины сгорела бы. Вне окна корзину не отмечаем:
 * напомним, когда покупатель напишет снова. Корзина без доступных позиций —
 * тишина, без отметки.
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
        .order("id", { ascending: false })
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
    // У Instagram/WhatsApp telegram_id синтетический отрицательный (customers.ts).
    if (!telegramId) continue;
    const cutoff = new Date(at);
    if (now.getTime() - cutoff.getTime() < hours * 3600_000) continue;

    const { data: user, error: userError } = await ctx.db
      .from("bot_users")
      .select("*")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (userError) throw serverFailure(`Напоминание о корзине: ${userError.message}`);
    if (!user || user.opt_out) continue;
    const platform = (user.platform as Platform) || "telegram";
    const eligible = shouldSendCartReminder(
      cutoff,
      now,
      hours,
      user.cart_reminder_sent_at ? new Date(user.cart_reminder_sent_at) : null,
    );
    if (!eligible) continue;
    // Заблокированному продавцом покупателю маркетинг не шлём, корзину не отмечаем.
    if ((await blockedAmong(ctx, [telegramId])).has(telegramId)) continue;
    // Потолок маркетинговых сообщений за сутки (core/marketing/cap): место занято —
    // корзину не отмечаем, напомним в следующий прогон, когда оно освободится.
    const state = stateFromJson(user.state);
    if (!marketingAllowed(state, cap, now)) continue;

    const customer = customerFromRow(user);
    // Покупатель сайта без мессенджера: писать некуда.
    if (platform === "web") continue;
    let summary: Awaited<ReturnType<typeof cartReminderSummary>>;
    try {
      if (platform !== "telegram") {
        // Direct/WhatsApp: нужен диалог Zernio и открытое окно ответа.
        if (!customer.zernioConversationId || !customer.zernioAccountId) continue;
        const w = replyWindow(platform, await lastInboundAt(ctx, telegramId), now.getTime());
        if (w?.state !== "open") continue;
      }
      summary = await cartReminderSummary(ctx, customer);
    } catch (e) {
      // Не прочиталось — корзину не отмечаем, напомним в следующий прогон.
      console.error(`[cart-reminder:${ctx.tenant.id}] ${telegramId}`, e);
      continue;
    }
    if (!summary) continue;

    // .is() сравнивает с NULL, .eq() — с прошлым значением; не взаимозаменяемы.
    const cas = ctx.db
      .from("bot_users")
      .update({ cart_reminder_sent_at: now.toISOString() })
      .eq("telegram_id", telegramId);
    const { data: claimed, error: claimError } = await (
      user.cart_reminder_sent_at
        ? cas.eq("cart_reminder_sent_at", user.cart_reminder_sent_at)
        : cas.is("cart_reminder_sent_at", null)
    )
      .select("telegram_id")
      .maybeSingle();
    if (claimError) {
      // Сбой записи — не «проиграли гонку»: оставляем след и пробуем в следующий прогон.
      console.error(`[cart-reminder:${ctx.tenant.id}] ${telegramId}: ${claimError.message}`);
      continue;
    }
    if (!claimed) continue;
    if (!(await claimMarketing(ctx, user.user_key, user.state, cap, now))) {
      // Место за сутки ушло другому сообщению (или state успел измениться):
      // возвращаем отметку корзины как была, иначе напоминание пропадёт насовсем.
      const back = ctx.db
        .from("bot_users")
        .update({ cart_reminder_sent_at: user.cart_reminder_sent_at })
        .eq("telegram_id", telegramId)
        .eq("cart_reminder_sent_at", now.toISOString());
      const { error } = await back;
      if (error) console.error(`[cart-reminder:${ctx.tenant.id}] ${telegramId}: ${error.message}`);
      continue;
    }

    const locale: Locale = isLocale(state.locale)
      ? state.locale
      : (ctx.tenant.settings.default_locale ?? "ru");
    let ok = false;
    try {
      ok = await send({ telegramId, locale, items: n, customer, ...summary });
    } catch (e) {
      console.error(`[cart-reminder:${ctx.tenant.id}] ${telegramId}`, e);
    }
    if (ok) sent++;
    await recordAutoMessage(ctx, "cart", telegramId, ok, now);
  }
  return { checked: last.size, sent, hours };
}
