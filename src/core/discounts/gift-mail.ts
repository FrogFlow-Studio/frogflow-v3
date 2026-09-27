import type { TenantContext } from "@/core/tenant/resolve.server";
import { giftCodeMail, isMailConfigured, smtpMailer, type Mailer } from "@/core/mail/mail.server";
import { recordOrderEvent } from "@/core/orders/events";
import { formatMoney } from "@/core/money/money";
import { getSetting } from "@/core/settings/settings";
import type { IssuedGift } from "./gift-sale";

/**
 * Код купленного сертификата — письмом покупателю. Без почты платформы
 * пропускаем, но продавец видит это в заказе: код всё равно на странице
 * заказа по личной ссылке.
 */
export async function emailGiftCode(
  ctx: TenantContext,
  order: {
    id: number;
    display_no?: number | null;
    order_no: number;
    customer_email: string | null;
  },
  gift: IssuedGift,
  mailer: Mailer = smtpMailer,
): Promise<{ sent: boolean }> {
  const to = order.customer_email?.trim();
  if (!to) return { sent: false };
  if (mailer === smtpMailer && !isMailConfigured()) {
    await recordOrderEvent(ctx, order.id, "email_failed", { to, error: "SMTP не настроен" });
    return { sent: false };
  }
  const shopName = (await getSetting(ctx, "shop_name")) || ctx.tenant.name;
  const slug = ctx.tenant.settings.slug;
  const r = await mailer({
    to,
    ...giftCodeMail({
      orderNo: order.display_no ?? order.order_no,
      shopName,
      code: gift.code,
      amount: formatMoney(gift.amount, gift.currency),
      shopUrl: slug ? `${ctx.appUrl}/s/${encodeURIComponent(slug)}` : null,
      locale: ctx.tenant.settings.default_locale ?? "ru",
    }),
  });
  await recordOrderEvent(
    ctx,
    order.id,
    r.ok ? "email_sent" : "email_failed",
    r.ok ? { to } : { to, error: r.error ?? "" },
  );
  return { sent: r.ok };
}
