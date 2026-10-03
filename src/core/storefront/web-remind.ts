import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { claimOrderEvent, recordOrderEvent } from "@/core/orders/events";
import {
  isMailConfigured,
  smtpMailer,
  unpaidOrderMail,
  type Mailer,
} from "@/core/mail/mail.server";
import { amountDueNow } from "@/core/fulfillment/fulfillment";
import { formatMoney } from "@/core/money/money";
import { getSetting } from "@/core/settings/settings";
import { eachPage } from "@/core/db/page";
import { orderAccessToken, webCheckoutSettings } from "./web-order";
import { WEB_ORDER_TTL_MS } from "./web-expire";

/**
 * Письмо о неоплаченном заказе с сайта: через 3 часа после оформления, пока
 * заказ ждёт оплаты и чека нет, — ссылка на страницу заказа (подписанная, та
 * же, что покупатель получил при оформлении). Одно письмо на заказ. Позже
 * 20 часов не пишем: до отмены через сутки (web-expire) остаётся мало, и
 * письмо пришло бы почти вместе с отменой. Почта платформы не настроена —
 * тихо пропускаем: без SMTP письмо не уйдёт ни одному покупателю. Продавец
 * выключил оформление на сайте — тоже не пишем: страница заказа закрыта.
 *
 * Заказы читаются постранично по (created_at, id): уже напомненные отсекает
 * метка, так что ни один заказ окна не выпадает, сколько бы их ни было. Перед
 * отправкой заказ перечитывается: оплаченный за время прогона письма не получит.
 */
export const WEB_REMIND_AFTER_MS = 3 * 3600_000;
export const WEB_REMIND_UNTIL_MS = 20 * 3600_000;

export async function remindWebOrders(
  ctx: TenantContext,
  secret: string,
  now = new Date(),
  mailer: Mailer = smtpMailer,
): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (mailer === smtpMailer && !isMailConfigured()) return out;
  const slug = ctx.tenant.settings.slug;
  if (!slug || !secret) return out;
  if (!(await webCheckoutSettings(ctx)).enabled) return out;
  let shopName: string | null = null;
  const remind = async (o: UnpaidRow) => {
    const to = o.customer_email?.trim();
    if (!to) return;
    if (!(await claimOrderEvent(ctx, o.id, "reminded", "email", { channel: "email", to }))) return;
    if (!(await stillUnpaid(ctx, o.id))) return;
    shopName ??= (await getSetting(ctx, "shop_name")) || ctx.tenant.name;
    const due = await amountDueNow(ctx, {
      total: Number(o.total),
      fulfillment_kind: o.fulfillment_kind,
    });
    const left = WEB_ORDER_TTL_MS - (now.getTime() - new Date(o.created_at).getTime());
    const url = `${ctx.appUrl}/s/${encodeURIComponent(slug)}/order/${o.id}?t=${orderAccessToken(secret, ctx.tenant.id, o.id)}`;
    const r = await mailer({
      to,
      ...unpaidOrderMail({
        orderNo: o.display_no ?? o.order_no,
        shopName,
        amount: formatMoney(due, o.currency),
        url,
        hoursLeft: Math.max(1, Math.floor(left / 3600_000)),
      }),
    });
    if (r.ok) out.sent++;
    else {
      out.failed++;
      await recordOrderEvent(ctx, o.id, "email_failed", { to, error: r.error ?? "" });
    }
  };
  await eachPage<UnpaidRow>(
    (from, to) =>
      ctx.db
        .from("orders")
        .select(
          "id, order_no, display_no, total, currency, fulfillment_kind, customer_email, created_at",
        )
        .eq("platform", "web")
        .eq("status", "awaiting_payment")
        .is("payment_proof_path", null)
        .lt("created_at", new Date(now.getTime() - WEB_REMIND_AFTER_MS).toISOString())
        .gt("created_at", new Date(now.getTime() - WEB_REMIND_UNTIL_MS).toISOString())
        .order("created_at")
        .order("id")
        .range(from, to),
    "web-remind",
    async (rows) => {
      for (const o of rows) await remind(o);
    },
    PAGE,
  );
  return out;
}

const PAGE = 200;

type UnpaidRow = {
  id: number;
  order_no: number;
  display_no: number | null;
  total: number;
  currency: string;
  fulfillment_kind: string;
  customer_email: string | null;
  created_at: string;
};

/** Перечитать перед отправкой: заказ всё ещё ждёт оплаты и чека к нему нет. */
async function stillUnpaid(ctx: TenantContext, id: number): Promise<boolean> {
  const { data, error: dataError } = await ctx.db
    .from("orders")
    .select("id")
    .eq("id", id)
    .eq("status", "awaiting_payment")
    .is("payment_proof_path", null)
    .maybeSingle();
  if (dataError) throw serverFailure(`Витрина: напоминание: ${dataError.message}`);
  return data != null;
}
