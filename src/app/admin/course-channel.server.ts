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
    .select("id, order_id, product_id, product_variant_id")
    .eq("id", orderItemId)
    .maybeSingle();
  if (error) {
    const { serverFailure } = await import("@/lib/server-failure");
    throw serverFailure(`Покупка не прочитана: ${error.message}`);
  }
  if (!item?.product_id) return { kicked: false };
  const { getSetting } = await import("@/core/settings/settings");
  const { courseKey, parseCourse } = await import("@/core/courses/course");
  const course = parseCourse(await getSetting(ctx, courseKey(item.product_id)));
  const { parseRun, runKey } = await import("@/core/courses/run.server");
  const run = parseRun(await getSetting(ctx, runKey(item.id)));
  const { data: order } = await ctx.db
    .from("orders")
    .select("platform, telegram_id, created_at")
    .eq("id", item.order_id)
    .maybeSingle();
  const { CHANNEL_SLOT, CHAT_SLOT, purchaseChat, revokeItemChannel } =
    await import("@/core/courses/channel.server");
  const chat = order
    ? purchaseChat(ctx, {
        course,
        run,
        boughtAt: order.created_at,
        variantId: item.product_variant_id,
      })
    : null;
  if (!course.channel && !chat) return { kicked: false };
  let token: string;
  try {
    token = ctx.secrets.telegramToken();
  } catch {
    return { kicked: false };
  }
  const { telegramChannelInviter } = await import("@/channels/telegram/courses");
  const access = telegramChannelInviter(telegramApi(token, env().TELEGRAM_API_BASE));
  const who = order ?? { platform: null, telegram_id: null };
  let kicked = false;
  // Исключение из канала и из чата потока — одной кнопкой «Исключить».
  for (const [target, slot] of [
    [course.channel, CHANNEL_SLOT],
    [chat, CHAT_SLOT],
  ] as const)
    if (target && (await revokeItemChannel(ctx, item.id, target, who, access, new Date(), slot)))
      kicked = true;
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

/** Перевод ученика в другой поток: исключение из старого чата — через бота магазина. */
export async function moveStudent(ctx: TenantContext, orderItemId: string, cohortId: string) {
  let access = null;
  try {
    const { telegramChannelInviter } = await import("@/channels/telegram/courses");
    access = telegramChannelInviter(
      telegramApi(ctx.secrets.telegramToken(), env().TELEGRAM_API_BASE),
    );
  } catch {
    /* бота нет — поток сменится, из чата удалить придётся вручную (событие в заказе скажет) */
  }
  const { moveStudentCohort } = await import("@/core/courses/move.server");
  return moveStudentCohort(ctx, orderItemId, cohortId, access);
}
