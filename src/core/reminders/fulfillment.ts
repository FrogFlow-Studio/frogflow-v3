import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Locale } from "@/core/i18n/locale";
import { isLocale } from "@/core/i18n/locale";
import { stateFromJson } from "@/core/customers/customers";
import { isoToDisplay } from "@/core/fulfillment/pure";
import { fulfillmentSlots, slotOf } from "@/core/fulfillment/slots";
import { fulfillmentLimits, loadOfDay, type DayLoad } from "@/core/fulfillment/capacity";
import { isFulfillmentReminderEligible } from "./pure";

export const OPEN_PHYSICAL_STATUSES = [
  "awaiting_confirmation",
  "awaiting_payment",
  "accepted",
  "in_production",
  "ready",
] as const;

export type FulfillmentReminder = {
  orderId: number;
  displayNo: string;
  telegramId: number;
  platform: string;
  locale: Locale;
  dateLabel: string;
  type: "pickup" | "delivery";
  address: string | null;
  /** Загрузка дня и слота заказа при заданных лимитах: продавцу — сколько уже набрано. */
  load: {
    total: number;
    dayLimit: number | null;
    slotCount: number | null;
    slotLimit: number | null;
  } | null;
};

/**
 * Напоминание о дате получения физического заказа: раз в час крон берёт
 * заказы, чья fulfillment_at попадает в ближайшие 24 часа, и шлёт ровно одно
 * напоминание покупателю и продавцу. Идемпотентность — CAS на
 * orders.fulfillment_reminder_sent_at (только .is(null): дата после
 * оформления не меняется, второго раза не бывает).
 */
export async function sendFulfillmentReminders(
  ctx: TenantContext,
  notify: (r: FulfillmentReminder) => Promise<void>,
  now = new Date(),
): Promise<{ checked: number; sent: number }> {
  const in24h = new Date(now.getTime() + 24 * 3600_000);
  const { data: orders, error } = await ctx.db
    .from("orders")
    .select(
      "id, order_no, display_no, telegram_id, platform, fulfillment_at, fulfillment_type, fulfillment_address, fulfillment_reminder_sent_at",
    )
    .eq("fulfillment_kind", "physical")
    .in("status", [...OPEN_PHYSICAL_STATUSES])
    .not("fulfillment_at", "is", null)
    .gt("fulfillment_at", now.toISOString())
    .lte("fulfillment_at", in24h.toISOString())
    .is("fulfillment_reminder_sent_at", null);
  if (error) throw serverFailure(`Напоминание о выдаче: ${error.message}`);
  if (!orders?.length) return { checked: 0, sent: 0 };

  const slots = await fulfillmentSlots(ctx);
  // Нет лимитов или не прочитались — напоминание уходит без строки о загрузке.
  const limits = await fulfillmentLimits(ctx).catch(() => ({ day: null, slot: null }));
  const loads = new Map<string, DayLoad>();
  let sent = 0;
  for (const o of orders) {
    const at = new Date(o.fulfillment_at!);
    if (!isFulfillmentReminderEligible(at, now, null)) continue;
    const { data: claimed } = await ctx.db
      .from("orders")
      .update({ fulfillment_reminder_sent_at: now.toISOString() })
      .eq("id", o.id)
      .is("fulfillment_reminder_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: buyer } = await ctx.db
      .from("bot_users")
      .select("state")
      .eq("telegram_id", o.telegram_id)
      .maybeSingle();
    const st = stateFromJson(buyer?.state);
    const locale: Locale = isLocale(st.locale)
      ? st.locale
      : (ctx.tenant.settings.default_locale ?? "ru");
    // Загрузка нужна только при лимитах; сбой чтения не мешает самому напоминанию.
    const day = o.fulfillment_at!.slice(0, 10);
    let load: FulfillmentReminder["load"] = null;
    if (limits.day !== null || limits.slot !== null) {
      try {
        if (!loads.has(day)) loads.set(day, await loadOfDay(ctx, day));
        const l = loads.get(day)!;
        const time = /T(\d{2}:\d{2})/.exec(o.fulfillment_at!)?.[1];
        load = {
          total: l.total,
          dayLimit: limits.day,
          slotCount: time && time !== "00:00" ? (l.slots[time] ?? 0) : null,
          slotLimit: limits.slot,
        };
      } catch (e) {
        console.error(`[fulfillment-reminder:${ctx.tenant.id}] загрузка дня ${day}`, e);
      }
    }
    try {
      await notify({
        orderId: o.id,
        displayNo: String(o.display_no ?? o.order_no ?? o.id),
        telegramId: Number(o.telegram_id),
        platform: o.platform ?? "telegram",
        locale,
        dateLabel: [isoToDisplay(o.fulfillment_at!.slice(0, 10)), slotOf(o.fulfillment_at, slots)]
          .filter(Boolean)
          .join(", "),
        type: o.fulfillment_type === "delivery" ? "delivery" : "pickup",
        address: o.fulfillment_address ?? null,
        load,
      });
      sent++;
    } catch (e) {
      console.error(`[fulfillment-reminder:${ctx.tenant.id}] order ${o.id}`, e);
    }
  }
  return { checked: orders.length, sent };
}
