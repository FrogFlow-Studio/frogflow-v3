import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { telegramApi } from "@/channels/telegram/api";
import { telegramMaterialSender } from "@/channels/telegram/deliver";
import { COPY } from "@/channels/telegram/copy";
import {
  deliverOrder,
  displayNo,
  getOrder,
  rejectOrder,
  type OrderWithItems,
} from "@/core/orders/orders";
import { verifyPassword } from "@/app/auth/password";
import type { Tenant } from "@/core/tenant/types";

export async function findTenantByAdminUsername(username: string): Promise<Tenant | null> {
  const u = username.trim().toLowerCase();
  return (
    (await tenantDirectory(true)).find((t) => t.settings.admin?.username === u && !t.archived) ??
    null
  );
}

export function checkAdminPassword(t: Tenant, password: string): boolean {
  return verifyPassword(password, t.settings.admin?.password_hash);
}

function api(ctx: TenantContext) {
  return telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE);
}

/** Уведомить покупателя в его канале: Telegram или Instagram/WhatsApp через Zernio. */
export async function notifyCustomer(
  ctx: TenantContext,
  order: OrderWithItems,
  text: string,
): Promise<boolean> {
  if (order.platform !== "telegram") {
    const { sendToZernioTarget, zernioTargetForOrder } =
      await import("@/channels/zernio/outbound.server");
    const target = await zernioTargetForOrder(ctx, order);
    return target ? sendToZernioTarget(target, text) : false;
  }
  if (!ctx.tenant.telegramTokenEnc) return false;
  const r = await api(ctx).call("sendMessage", {
    chat_id: order.telegram_id,
    text,
    parse_mode: "HTML",
  });
  return r.ok;
}

export type OrderAction = "confirm" | "reject" | "next" | "prev" | "remind";

export async function runOrderAction(
  ctx: TenantContext,
  id: number,
  action: OrderAction,
): Promise<{ ok: boolean; message: string }> {
  const order = await getOrder(ctx, id);
  if (!order) return { ok: false, message: "Заказ не найден" };
  const no = displayNo(order);
  const m = COPY.ru;
  switch (action) {
    case "reject": {
      const ok = await rejectOrder(ctx, id);
      if (ok) await notifyCustomer(ctx, order, m.orderRejected(no));
      return ok
        ? { ok, message: `Заказ #${no} отклонён` }
        : { ok, message: `Заказ #${no} уже закрыт (${order.status})` };
    }
    case "confirm": {
      if (order.fulfillment_kind === "physical") {
        const { setPhysicalStatus } = await import("@/core/orders/admin");
        const ok =
          (await setPhysicalStatus(ctx, id, "awaiting_confirmation", "accepted")) ||
          (await setPhysicalStatus(ctx, id, "awaiting_payment", "accepted"));
        if (ok) await notifyCustomer(ctx, order, `✅ Заказ #${no} принят в работу.`);
        return {
          ok,
          message: ok
            ? `Заказ #${no} принят`
            : `Заказ #${no} нельзя принять из статуса ${order.status}`,
        };
      }
      let sender = telegramMaterialSender(api(ctx), order.telegram_id, m);
      if (order.platform !== "telegram") {
        const { zernioSenderFor, zernioTargetForOrder } =
          await import("@/channels/zernio/outbound.server");
        const target = await zernioTargetForOrder(ctx, order);
        if (!target)
          return { ok: false, message: `У покупателя из ${order.platform} нет диалога для выдачи` };
        sender = zernioSenderFor(target);
      }
      const r = await deliverOrder(ctx, id, sender, "ru");
      if (r.alreadyDelivered) return { ok: true, message: `Заказ #${no} уже выдан` };
      if (r.failed === 0) {
        await notifyCustomer(ctx, order, m.orderDelivered(no));
        if (r.pointsEarned > 0) await notifyCustomer(ctx, order, m.pointsEarned(r.pointsEarned));
        await notifyReferralGrant(ctx, r.referral);
        return { ok: true, message: `Заказ #${no} выдан: ${r.sent} поз.` };
      }
      return {
        ok: false,
        message: `Выдано ${r.sent}, не удалось ${r.failed}. Проверьте файлы товаров и повторите.`,
      };
    }
    case "next":
    case "prev": {
      const { PHYSICAL_NEXT, PHYSICAL_PREV, setPhysicalStatus } =
        await import("@/core/orders/admin");
      const to = (action === "next" ? PHYSICAL_NEXT : PHYSICAL_PREV)[order.status];
      if (!to) return { ok: false, message: "Из этого статуса перехода нет" };
      const ok = await setPhysicalStatus(ctx, id, order.status, to);
      const labels: Record<string, string> = {
        in_production: "🧑‍🍳 Заказ готовится",
        ready: "🎉 Заказ готов к выдаче",
        delivered: "✅ Заказ выдан. Спасибо!",
        accepted: "Заказ принят",
      };
      if (ok && action === "next") await notifyCustomer(ctx, order, `${labels[to] ?? to} — #${no}`);
      if (ok && to === "delivered") {
        const { rewardReferrerIfFirstDelivery } = await import("@/core/referrals/referrals");
        await notifyReferralGrant(ctx, await rewardReferrerIfFirstDelivery(ctx, order.telegram_id));
      }
      return { ok, message: ok ? `Статус: ${to}` : "Статус уже изменился" };
    }
    case "remind": {
      if (order.status !== "awaiting_payment")
        return { ok: false, message: "Напоминание только для заказов, ждущих оплаты" };
      const ok = await notifyCustomer(
        ctx,
        order,
        `⏰ Напоминаем: заказ #${no} на ${order.total} ${order.currency} ждёт оплаты. Пришлите чек после перевода.`,
      );
      return { ok, message: ok ? "Напоминание отправлено" : "Не удалось отправить" };
    }
  }
}

/** Ответ менеджера из панели: тем же sendMessage, что и у бота, плюс запись в лог чата. */
/** Ответ менеджера из панели — в канал покупателя: Telegram или Instagram/WhatsApp через Zernio. */
export async function replyAsManager(
  ctx: TenantContext,
  telegramId: number,
  text: string,
): Promise<void> {
  const { getCustomerByTelegramId } = await import("@/core/customers/customers");
  const customer = await getCustomerByTelegramId(ctx, telegramId);
  if (customer && customer.platform !== "telegram") {
    if (!customer.zernioConversationId || !customer.zernioAccountId)
      throw new Error("У покупателя нет диалога в Zernio — ответить некуда");
    const { sendInboxMessage } = await import("@/channels/zernio/api.server");
    const r = await sendInboxMessage(
      customer.zernioConversationId,
      customer.zernioAccountId,
      text,
      {
        platform: customer.platform,
      },
    );
    if (!r.ok) throw new Error(r.error || "Не удалось отправить сообщение");
  } else {
    const r = await api(ctx).call("sendMessage", { chat_id: telegramId, text });
    if (!r.ok) throw new Error(r.description || "Не удалось отправить сообщение в Telegram");
  }
  const { recordMessage } = await import("@/core/chat/chat");
  await recordMessage(ctx, { telegramId, direction: "out", sender: "manager", text });
}

async function notifyReferralGrant(
  ctx: TenantContext,
  grant: { telegramId: number; code: string; percent: number } | null | undefined,
): Promise<void> {
  if (!grant || !ctx.tenant.telegramTokenEnc) return;
  await api(ctx).call("sendMessage", {
    chat_id: grant.telegramId,
    text: COPY.ru.referralReward(grant.percent, grant.code),
    parse_mode: "HTML",
  });
}
