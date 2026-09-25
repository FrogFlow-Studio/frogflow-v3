import { env } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { telegramApi } from "@/channels/telegram/api";
import { telegramLanguageAsker, telegramMaterialSender } from "@/channels/telegram/deliver";
import { COPY } from "@/channels/telegram/copy";
import {
  deliverOrder,
  displayNo,
  getOrder,
  rejectOrder,
  type OrderWithItems,
  type DeliverOptions,
} from "@/core/orders/orders";
import { hashPassword, verifyPassword } from "@/app/auth/password";
import { patchTenantSettings } from "@/core/tenant/resolve.server";
import {
  adminLoginTaken,
  findAdminLogin,
  normalizeLogin,
  type AdminLogin,
} from "@/core/auth/roles";

/** Кто входит под логином: владелец или пользователь магазина (core/auth/roles). */
export async function resolveAdminLogin(username: string): Promise<AdminLogin | null> {
  return findAdminLogin(await tenantDirectory(true), username);
}

export function checkAdminPassword(login: AdminLogin, password: string): boolean {
  return verifyPassword(password, login.passwordHash);
}

/* ── команда магазина: пользователи с ролями в bots.settings.admin.users ── */

export type TeamMember = {
  username: string;
  name: string | null;
  role: "manager" | "viewer";
  createdAt: string | null;
};

export function listTeam(ctx: TenantContext): TeamMember[] {
  return (ctx.tenant.settings.admin?.users ?? []).map((u) => ({
    username: u.username,
    name: u.name ?? null,
    role: u.role,
    createdAt: u.created_at ?? null,
  }));
}

export async function saveTeamMember(
  ctx: TenantContext,
  input: { username: string; name?: string; role: "manager" | "viewer"; password?: string },
): Promise<void> {
  const username = normalizeLogin(input.username);
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username))
    throw new Error("Логин: латиница, цифры, точка, дефис и «_», от 3 до 40 символов.");
  if (username === ctx.tenant.settings.admin?.username)
    throw new Error("Это логин владельца магазина.");
  const users = [...(ctx.tenant.settings.admin?.users ?? [])];
  const existing = users.find((u) => u.username === username);
  if (adminLoginTaken(await tenantDirectory(true), username, { botId: ctx.tenant.id, username }))
    throw new Error(`Логин «${username}» уже занят.`);
  if (!existing && !input.password) throw new Error("Для нового пользователя нужен пароль.");
  if (input.password && input.password.length < 8)
    throw new Error("Пароль — не короче 8 символов.");
  const next = {
    username,
    password_hash: input.password ? hashPassword(input.password) : existing!.password_hash,
    role: input.role,
    name: input.name?.trim() || undefined,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };
  const merged = existing
    ? users.map((u) => (u.username === username ? next : u))
    : [...users, next];
  if (merged.length > 20) throw new Error("Не больше 20 пользователей у магазина.");
  await patchTenantSettings(ctx.tenant.id, { admin: { users: merged } });
}

export async function deleteTeamMember(ctx: TenantContext, username: string): Promise<void> {
  const u = normalizeLogin(username);
  const users = (ctx.tenant.settings.admin?.users ?? []).filter((x) => x.username !== u);
  await patchTenantSettings(ctx.tenant.id, { admin: { users } });
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
  const { sendOrEnqueue } = await import("@/core/outbox/outbox");
  if (order.platform !== "telegram") {
    const { zernioTargetForOrder } = await import("@/channels/zernio/outbound.server");
    const { zernioOutboxSender } = await import("@/channels/zernio/outbox.server");
    const target = await zernioTargetForOrder(ctx, order);
    if (!target) return false;
    return sendOrEnqueue(
      ctx,
      {
        kind: "customer_notice",
        target: { channel: "zernio", ...target },
        text,
        orderId: order.id,
        audience: "customer",
      },
      zernioOutboxSender(),
    );
  }
  if (!ctx.tenant.telegramTokenEnc) return false;
  const { telegramOutboxSender } = await import("@/channels/telegram/outbox");
  const ok = await sendOrEnqueue(
    ctx,
    {
      kind: "customer_notice",
      target: { channel: "telegram", chatId: String(order.telegram_id) },
      text,
      orderId: order.id,
      audience: "customer",
    },
    telegramOutboxSender,
  );
  if (!ok) {
    const { recordOrderEvent } = await import("@/core/orders/events");
    await recordOrderEvent(ctx, order.id, "notify_failed", {
      text: text.slice(0, 120),
      retrying: true,
    });
  }
  return ok;
}

export type OrderAction = "confirm" | "reject" | "next" | "prev" | "remind";

export async function runOrderAction(
  ctx: TenantContext,
  id: number,
  action: OrderAction,
  actor = "admin",
): Promise<{ ok: boolean; message: string }> {
  const order = await getOrder(ctx, id);
  if (!order) return { ok: false, message: "Заказ не найден" };
  const no = displayNo(order);
  const m = COPY.ru;
  switch (action) {
    case "reject": {
      const ok = await rejectOrder(ctx, id, actor);
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
      let opts: DeliverOptions = {
        lang: "ru",
        ask: telegramLanguageAsker(api(ctx), order.telegram_id, m),
        actor,
      };
      if (order.platform !== "telegram") {
        const { zernioSenderFor, zernioTargetForOrder } =
          await import("@/channels/zernio/outbound.server");
        const target = await zernioTargetForOrder(ctx, order);
        if (!target)
          return { ok: false, message: `У покупателя из ${order.platform} нет диалога для выдачи` };
        sender = zernioSenderFor(target);
        opts = { lang: "ru", allWhenAmbiguous: true, actor };
      }
      const r = await deliverOrder(ctx, id, sender, opts);
      if (r.alreadyDelivered) return { ok: true, message: `Заказ #${no} уже выдан` };
      if (r.failed === 0 && r.pending > 0)
        return {
          ok: true,
          message: `Заказ #${no}: покупателю задан вопрос о языке (${r.pending} поз.) — файлы уйдут после ответа`,
        };
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
      if (ok) {
        const { recordOrderEvent } = await import("@/core/orders/events");
        await recordOrderEvent(ctx, id, "status", { to }, actor);
      }
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
      if (ok) {
        const { recordOrderEvent } = await import("@/core/orders/events");
        await recordOrderEvent(ctx, id, "reminded", {}, actor);
      }
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
