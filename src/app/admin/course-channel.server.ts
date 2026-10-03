import { env } from "@/config/env";
import { telegramApi } from "@/channels/telegram/api";
import { COURSE_CHANNEL_RE } from "@/core/courses/course";
import type { TenantContext } from "@/core/tenant/resolve.server";

/**
 * Проверка закрытого канала курса перед сохранением: канал виден боту
 * магазина, бот в нём администратор и может приглашать. Без этого ученик
 * не получит ссылку (core/courses/channel.server). Только чтение из Telegram.
 */
export type ChannelCheck =
  | { ok: true; title: string }
  | { ok: false; reason: "badId" | "noBot" | "notFound" | "notAdmin" | "cannotInvite" };

type Member = { status?: string; can_invite_users?: boolean };

export async function checkCourseChannel(
  ctx: TenantContext,
  channel: string,
): Promise<ChannelCheck> {
  const id = channel.trim();
  if (!COURSE_CHANNEL_RE.test(id)) return { ok: false, reason: "badId" };
  let token: string;
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    return { ok: false, reason: "noBot" };
  }
  const api = telegramApi(token, env().TELEGRAM_API_BASE);
  const me = await api.call<{ id?: number }>("getMe");
  if (!me.ok || !me.result?.id) return { ok: false, reason: "noBot" };
  const chat = await api.call<{ title?: string }>("getChat", { chat_id: id });
  if (!chat.ok) return { ok: false, reason: "notFound" };
  const m = await api.call<Member>("getChatMember", { chat_id: id, user_id: me.result.id });
  const status = m.ok ? m.result?.status : undefined;
  if (status !== "administrator" && status !== "creator") return { ok: false, reason: "notAdmin" };
  if (status === "administrator" && m.result?.can_invite_users === false)
    return { ok: false, reason: "cannotInvite" };
  return { ok: true, title: chat.result?.title ?? id };
}

/**
 * Продавец исключает ученика из закрытого канала курса (кнопка в списке
 * учеников): та же отметка «снято», что при возврате, — новых ссылок по
 * этой покупке больше нет. false — исключать было некого или уже снято.
 */
export async function revokeStudentChannel(
  ctx: TenantContext,
  orderItemId: string,
): Promise<{ kicked: boolean }> {
  const { data: item, error } = await ctx.db
    .from("order_items")
    .select("id, order_id, product_id")
    .eq("id", orderItemId)
    .maybeSingle();
  if (error) {
    const { serverFailure } = await import("@/lib/server-failure");
    throw serverFailure(`Покупка не прочитана: ${error.message}`);
  }
  if (!item?.product_id) return { kicked: false };
  const { getSetting } = await import("@/core/settings/settings");
  const { courseKey, parseCourse } = await import("@/core/courses/course");
  const chat = parseCourse(await getSetting(ctx, courseKey(item.product_id))).channel;
  if (!chat) return { kicked: false };
  const { data: order } = await ctx.db
    .from("orders")
    .select("platform, telegram_id")
    .eq("id", item.order_id)
    .maybeSingle();
  let token: string;
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    return { kicked: false };
  }
  const { revokeItemChannel } = await import("@/core/courses/channel.server");
  const { telegramChannelInviter } = await import("@/channels/telegram/courses");
  const kicked = await revokeItemChannel(
    ctx,
    item.id,
    chat,
    order ?? { platform: null, telegram_id: null },
    telegramChannelInviter(telegramApi(token, env().TELEGRAM_API_BASE)),
  );
  return { kicked };
}

/** «В канале без доступа»: кого бот видел вступившим, а действующей покупки нет. */
export async function listChannelStrangers(ctx: TenantContext) {
  const { channelStrangers } = await import("@/core/courses/channel-seen.server");
  return channelStrangers(ctx);
}

/** Продавец исключает постороннего из канала курса (кнопка «Исключить»). */
export async function kickStranger(
  ctx: TenantContext,
  channel: string,
  userId: number,
): Promise<{ kicked: boolean }> {
  let token: string;
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    return { kicked: false };
  }
  const { kickChannelStranger } = await import("@/core/courses/channel-seen.server");
  const { telegramChannelInviter } = await import("@/channels/telegram/courses");
  return kickChannelStranger(
    ctx,
    channel,
    userId,
    telegramChannelInviter(telegramApi(token, env().TELEGRAM_API_BASE)),
  );
}
