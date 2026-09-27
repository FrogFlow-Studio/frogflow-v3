import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  isMailConfigured,
  orderNoticeMail,
  smtpMailer,
  type Mailer,
} from "@/core/mail/mail.server";
import { recordOrderEvent } from "@/core/orders/events";
import type { OrderWithItems } from "@/core/orders/orders";
import { getSetting } from "@/core/settings/settings";
import { orderAccessToken } from "./web-order";

/**
 * Уведомление покупателю с сайта о его заказе письмом: чата с ним нет, а
 * смену статуса, отказ и напоминание покупатель из бота получает
 * сообщением. В письме — текст уведомления и подписанная ссылка на
 * страницу заказа (та же, что при оформлении). Почта платформы не
 * настроена или письмо не ушло — в журнал заказа «письмо не отправлено»,
 * продавец это видит; нет почты у заказа — тихо false.
 */
export async function emailOrderNotice(
  ctx: TenantContext,
  order: Pick<OrderWithItems, "id" | "order_no" | "display_no" | "customer_email">,
  notice: string,
  secret: string,
  mailer: Mailer = smtpMailer,
): Promise<boolean> {
  const to = order.customer_email?.trim();
  const slug = ctx.tenant.settings.slug;
  if (!to || !slug || !secret) return false;
  if (mailer === smtpMailer && !isMailConfigured()) {
    await recordOrderEvent(ctx, order.id, "email_failed", { to, error: "SMTP не настроен" }, "bot");
    return false;
  }
  const shopName = (await getSetting(ctx, "shop_name")) || ctx.tenant.name;
  const url = `${ctx.appUrl}/s/${encodeURIComponent(slug)}/order/${order.id}?t=${orderAccessToken(secret, ctx.tenant.id, order.id)}`;
  const r = await mailer({
    to,
    ...orderNoticeMail({ orderNo: order.display_no ?? order.order_no, shopName, notice, url }),
  });
  await recordOrderEvent(
    ctx,
    order.id,
    r.ok ? "email_sent" : "email_failed",
    r.ok ? { to, kind: "notice" } : { to, error: r.error ?? "" },
    "bot",
  );
  return r.ok;
}
