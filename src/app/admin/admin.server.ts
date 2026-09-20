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

/** Уведомить покупателя в его канале. Пока только Telegram; Direct — фаза 4. */
export async function notifyCustomer(
  ctx: TenantContext,
  order: OrderWithItems,
  text: string,
): Promise<boolean> {
  if (order.platform !== "telegram" || !ctx.tenant.telegramTokenEnc) return false;
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
      if (order.platform !== "telegram")
        return { ok: false, message: `Выдача в ${order.platform} переносится в следующей фазе` };
      const r = await deliverOrder(
        ctx,
        id,
        telegramMaterialSender(api(ctx), order.telegram_id, m),
        "ru",
      );
      if (r.alreadyDelivered) return { ok: true, message: `Заказ #${no} уже выдан` };
      if (r.failed === 0) {
        await notifyCustomer(ctx, order, m.orderDelivered(no));
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
