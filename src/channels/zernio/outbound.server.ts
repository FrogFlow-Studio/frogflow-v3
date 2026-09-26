import type { TenantContext } from "@/core/tenant/resolve.server";
import { getCustomer, getCustomerByTelegramId, type Customer } from "@/core/customers/customers";
import type { MaterialSender } from "@/core/orders/orders";
import { liveTransport, type ZernioTransport } from "./api.server";
import { zernioMaterialSender } from "./deliver";
import { isZernioPlatform, type ZernioPlatform } from "./platform";
import { plain } from "./shop-flow";

/** Куда писать покупателю из Instagram/WhatsApp — по его записи в bot_users. */
export type ZernioTarget = {
  conversationId: string;
  accountId: string;
  platform: ZernioPlatform;
  /** Номер WhatsApp — чтобы написать первым, когда 24-часовое окно закрылось. */
  phone?: string | null;
};

export function zernioTargetOf(customer: Customer | null): ZernioTarget | null {
  if (!customer || !isZernioPlatform(customer.platform)) return null;
  if (!customer.zernioConversationId || !customer.zernioAccountId) return null;
  return {
    conversationId: customer.zernioConversationId,
    accountId: customer.zernioAccountId,
    platform: customer.platform,
    phone: customer.contactPhone,
  };
}

/** Покупатель заказа: по user_key, а для старых строк без него — по telegram_id. */
export async function zernioTargetForOrder(
  ctx: TenantContext,
  order: { user_key: string | null; telegram_id: number; platform: string },
): Promise<ZernioTarget | null> {
  if (order.platform === "telegram") return null;
  const customer = order.user_key
    ? await getCustomer(ctx, order.user_key)
    : await getCustomerByTelegramId(ctx, Number(order.telegram_id));
  return zernioTargetOf(customer);
}

/** Текст покупателю в его канал (HTML снимается — Direct его не рисует). */
export async function sendToZernioTarget(
  target: ZernioTarget,
  html: string,
  transport: ZernioTransport = liveTransport,
): Promise<boolean> {
  const r = await transport.send(target.conversationId, target.accountId, plain(html), {
    platform: target.platform,
  });
  return r.ok;
}

export function zernioSenderFor(
  target: ZernioTarget,
  transport: ZernioTransport = liveTransport,
): MaterialSender {
  return zernioMaterialSender(transport, target.conversationId, target.accountId, target.platform);
}
