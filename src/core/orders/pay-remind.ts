import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimOrderEvent } from "@/core/orders/events";
import { paymentMethodFor } from "@/core/orders/orders";
import { amountDueNow } from "@/core/fulfillment/fulfillment";
import { getSetting } from "@/core/settings/settings";
import { eachPage } from "@/core/db/page";
import { isInvoiceLink } from "./invoice-link";
import { PAY_REMIND_EVENT_KEY, PAY_REMIND_KEY, parsePayRemindHours } from "./pay-remind-settings";

export { PAY_REMIND_HOURS, PAY_REMIND_KEY, parsePayRemindHours } from "./pay-remind-settings";

/**
 * Напоминание об оплате заказа, оформленного в боте, Instagram или WhatsApp
 * (для сайта — письмо, core/storefront/web-remind). Выключено по умолчанию:
 * в v1 такого не было, и покупатели переехавших магазинов не должны получить
 * неожиданное. Продавец включает и выбирает, через сколько часов напомнить.
 *
 * Одно сообщение на заказ: метка «напомнили» ставится условной записью до
 * отправки, заказ перечитывается перед отправкой. Позже 20 часов не пишем:
 * чек, присланный после напоминания, бот должен привязать к этому заказу
 * (recentAwaitingPaymentOrder смотрит сутки). В Instagram и WhatsApp пишем
 * только внутри окна Meta (chatWindowOpen), иначе сообщение не уйдёт —
 * пропускаем, не падая. Это служебное сообщение
 * о заказе: отписка от рассылок на него не влияет.
 */
export const PAY_REMIND_UNTIL_MS = 20 * 3600_000;
/** Окно Meta — 24 часа с последнего сообщения покупателя; час запаса. */
export const CHAT_WINDOW_MS = 23 * 3600_000;

const CHAT_PLATFORMS = ["telegram", "instagram", "whatsapp"] as const;

export type PayReminder = {
  orderId: number;
  no: number;
  platform: string;
  telegramId: number;
  /** Сколько платить сейчас: весь заказ или задаток. */
  due: number;
  total: number;
  currency: string;
  /** Реквизиты способа оплаты страны заказа; нет — «уточните у продавца». */
  instructions: string | null;
  /** Счёт ссылкой из диалога (#194): вместо реквизитов — ссылка на страницу заказа. */
  invoiceLink: boolean;
};

export type PayReminderOrder = {
  id: number;
  order_no: number;
  display_no: number | null;
  telegram_id: number;
  platform: string | null;
  total: number;
  currency: string;
  fulfillment_kind: string;
  country_code: string | null;
  created_at: string;
};

const PAGE = 200;

/** Что написать покупателю по заказу: сумма сейчас, реквизиты или ссылка. */
export async function payReminderFor(
  ctx: TenantContext,
  o: PayReminderOrder,
): Promise<PayReminder> {
  const invoiceLink = await isInvoiceLink(ctx, o.id);
  const [due, method] = await Promise.all([
    amountDueNow(ctx, { total: Number(o.total), fulfillment_kind: o.fulfillment_kind }),
    !invoiceLink && o.country_code ? paymentMethodFor(ctx, o.country_code) : null,
  ]);
  return {
    orderId: o.id,
    no: o.display_no ?? o.order_no,
    platform: o.platform ?? "telegram",
    telegramId: Number(o.telegram_id),
    due,
    total: Number(o.total),
    currency: o.currency,
    instructions: method?.instructions?.trim() || null,
    invoiceLink,
  };
}

/**
 * Захват напоминания по заказу из чата — общий для крона и кнопки
 * «Напомнить» в админке: одно напоминание на заказ.
 */
export function claimPayReminder(
  ctx: TenantContext,
  orderId: number,
  platform: string,
  actor = "bot",
): Promise<boolean> {
  return claimOrderEvent(
    ctx,
    orderId,
    "reminded",
    PAY_REMIND_EVENT_KEY,
    { channel: platform },
    actor,
  );
}

export async function remindChatOrders(
  ctx: TenantContext,
  send: (r: PayReminder) => Promise<boolean>,
  now = new Date(),
): Promise<{ sent: number; failed: number; skipped: number } | { off: true }> {
  // Мягкое чтение: пусто безопасно — сработает срок напоминания по умолчанию, денег это не двигает.
  const hours = parsePayRemindHours(await getSetting(ctx, PAY_REMIND_KEY));
  if (hours === null) return { off: true };
  const out = { sent: 0, failed: 0, skipped: 0 };
  const remind = async (o: PayReminderOrder) => {
    const platform = o.platform ?? "telegram";
    const zernio = platform === "instagram" || platform === "whatsapp";
    if (!zernio && Number(o.telegram_id) <= 0) return;
    if (zernio && !(await chatWindowOpen(ctx, o, now))) {
      out.skipped++;
      return;
    }
    if (!(await claimPayReminder(ctx, o.id, platform))) return;
    if (!(await stillUnpaid(ctx, o.id))) return;
    const ok = await payReminderFor(ctx, o)
      .then(send)
      .catch((e) => {
        console.error(`[pay-remind:${ctx.tenant.id}] заказ ${o.id}: ${String(e)}`);
        return false;
      });
    if (ok) out.sent++;
    else out.failed++;
  };
  await eachPage<PayReminderOrder>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select(
          "id, order_no, display_no, telegram_id, platform, total, currency, fulfillment_kind, country_code, created_at",
        )
        .in("platform", [...CHAT_PLATFORMS])
        .eq("status", "awaiting_payment")
        .is("payment_proof_path", null)
        .lt("created_at", new Date(now.getTime() - hours * 3600_000).toISOString())
        .gt("created_at", new Date(now.getTime() - PAY_REMIND_UNTIL_MS).toISOString())
        .order("created_at")
        .order("id")
        .range(from, to),
    "pay-remind",
    async (rows) => {
      for (const o of rows) await remind(o);
    },
    PAGE,
  );
  return out;
}

/**
 * Окно Meta открыто. Заказ из директа покупатель оформил сам — его сообщение
 * не раньше заказа, а напоминаем мы не позже 20 часов после него, так что
 * окно открыто всегда (и для магазина без «Чата», где журнала нет). Счёт
 * ссылкой (#194) создаёт продавец из «Чата» — там окно считаем по последнему
 * входящему в журнале «Чата», который при этом модуле ведётся.
 */
async function chatWindowOpen(ctx: TenantContext, o: PayReminderOrder, now: Date) {
  const since = now.getTime() - CHAT_WINDOW_MS;
  if (!(await isInvoiceLink(ctx, o.id))) return Date.parse(o.created_at) > since;
  const { data, error: dataError } = await ctx.db
    .from("manager_chat_messages")
    .select("id")
    .eq("telegram_id", Number(o.telegram_id))
    .eq("direction", "in")
    .gt("created_at", new Date(since).toISOString())
    .limit(1)
    .maybeSingle();
  if (dataError) throw serverFailure(`Заказы: напоминание: ${dataError.message}`);
  return data != null;
}

/** Перечитать перед отправкой: заказ всё ещё ждёт оплаты и чека к нему нет. */
async function stillUnpaid(ctx: TenantContext, id: number): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("orders")
    .select("id")
    .eq("id", id)
    .eq("status", "awaiting_payment")
    .is("payment_proof_path", null)
    .maybeSingle();
  if (dataError) throw serverFailure(`Заказы: напоминание: ${dataError.message}`);
  return data != null;
}
