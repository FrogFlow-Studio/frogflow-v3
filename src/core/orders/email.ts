import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  isMailConfigured,
  orderMaterialsMail,
  smtpMailer,
  type Mailer,
} from "@/core/mail/mail.server";
import { getSetting } from "@/core/settings/settings";
import { protectMaterials } from "@/core/delivery/watermark.server";
import { recordOrderEvent } from "./events";
import {
  itemLanguages,
  itemMaterials,
  materialDownloadName,
  parseDeliveredLanguages,
  signedFileUrl,
  type OrderWithItems,
} from "./orders";

export const EMAIL_LINK_DAYS = 7;

/**
 * Копия материалов на почту покупателя из Instagram/WhatsApp (перенос из v1):
 * ссылки в переписке живут 7 дней и теряются в ленте, письмо — постоянный
 * адрес. Отправляется после выдачи, когда у заказа есть почта; без SMTP или
 * почты — тихо пропускается, в таймлайн пишется итог.
 */
export async function emailOrderMaterials(
  ctx: TenantContext,
  order: OrderWithItems,
  mailer: Mailer = smtpMailer,
): Promise<{ sent: boolean; reason?: string }> {
  if (order.platform === "telegram") return { sent: false, reason: "telegram" };
  const to = order.customer_email?.trim();
  if (!to) return { sent: false, reason: "нет почты" };
  if (mailer === smtpMailer && !isMailConfigured())
    return { sent: false, reason: "SMTP не настроен" };
  const files: Array<{ name: string; url: string }> = [];
  for (const item of order.order_items) {
    const delivered = parseDeliveredLanguages(item.delivered_language);
    const langs = itemLanguages(item).filter((l) => delivered.size === 0 || delivered.has(l));
    for (const l of langs.length ? langs : itemLanguages(item)) {
      const list = await protectMaterials(ctx, order, itemMaterials(item, l));
      for (const mat of list) {
        const url =
          mat.url ??
          (mat.path
            ? await signedFileUrl(
                mat.path,
                EMAIL_LINK_DAYS * 24 * 3600,
                materialDownloadName(mat, item.name_snapshot, list),
              )
            : null);
        if (url) files.push({ name: mat.name ?? item.name_snapshot, url });
      }
    }
  }
  if (!files.length) return { sent: false, reason: "нет файлов" };
  const shopName = (await getSetting(ctx, "shop_name")) || ctx.tenant.name;
  const no = order.display_no ?? order.order_no;
  const r = await mailer({
    to,
    ...orderMaterialsMail({ orderNo: no, shopName, files, linkDays: EMAIL_LINK_DAYS }),
  });
  await recordOrderEvent(
    ctx,
    order.id,
    r.ok ? "email_sent" : "email_failed",
    r.ok ? { to, files: files.length } : { to, error: r.error },
    "bot",
  );
  return r.ok ? { sent: true } : { sent: false, reason: r.error };
}
