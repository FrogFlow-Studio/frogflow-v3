import { createHash } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, trySetSetting, updateSettingAtomic } from "@/core/settings/settings";
import { courseTimeline } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { selectIn } from "./db.server";
import { parseRun, runKey, type CoursePurchase } from "./run.server";

/**
 * Доступ в закрытый канал курса (ниша «Онлайн-школа»): ученик получает
 * личную ссылку-приглашение (на одного человека, на сутки). Ядро не знает
 * Telegram — ссылку создаёт и участника исключает канал через порт
 * `ChannelAccess` токеном бота магазина.
 *
 * Ссылка — доступ к платному, поэтому «одна на покупку» держится условной
 * записью до обращения к Telegram: `app_settings.course_inv_<позиция>`
 * сначала бронируется (`pending`), и только выигравший бронь создаёт ссылку.
 * Двойной клик или две вкладки не выпускают второе приглашение; пока ссылка
 * действует, выдаётся она же. Кто вступил по ссылке, бот узнаёт из события
 * chat_member и записывает (`member`): новую ссылку получит только тот, кто
 * из канала вышел, а возврат денег исключает именно его.
 */
export const INVITE_KEY_PREFIX = "course_inv_";
export const inviteKey = (orderItemId: string) => `${INVITE_KEY_PREFIX}${orderItemId}`;
/** Ссылка → позиция заказа: по ней событие вступления находит покупку. */
export const INVITE_LINK_PREFIX = "course_invlink_";
const linkKey = (link: string, prefix = INVITE_LINK_PREFIX) =>
  `${prefix}${createHash("sha256").update(link).digest("hex").slice(0, 24)}`;

/**
 * Куда пускаем: закрытый канал курса или групповой чат потока. Устроены
 * одинаково (личная ссылка на покупку, «вступил», «снято»), записи — свои.
 */
export type Slot = { key: (orderItemId: string) => string; linkPrefix: string };
export const CHANNEL_SLOT: Slot = { key: inviteKey, linkPrefix: INVITE_LINK_PREFIX };
export const CHAT_KEY_PREFIX = "course_invg_";
export const CHAT_SLOT: Slot = {
  key: (id) => `${CHAT_KEY_PREFIX}${id}`,
  linkPrefix: "course_invglink_",
};

/** Сколько живёт приглашение. */
export const INVITE_TTL_S = 24 * 3600;
/** Бронь, после которой создание ссылки считается оборвавшимся. */
const PENDING_MS = 60_000;
/** Ссылку, которая вот-вот истечёт, не отдаём — выпускаем новую. */
const REUSE_MARGIN_MS = 3600_000;

export type ChannelAccess = {
  /** Ссылка на одного участника до `expireDate` (unix, с); null — Telegram отказал. */
  createInvite(chatId: string, name: string, expireDate: number): Promise<string | null>;
  /** Состоит ли человек в канале сейчас; null — не удалось узнать. */
  isMember?(chatId: string, userId: number): Promise<boolean | null>;
  /** Исключить без запрета вернуться по новой ссылке. */
  kick?(chatId: string, userId: number): Promise<boolean>;
  revokeInvite?(chatId: string, link: string): Promise<void>;
};
/** Прежнее имя порта. */
export type ChannelInviter = ChannelAccess;

type InviteRecord = {
  link?: string;
  exp?: number;
  pending?: string;
  /** Telegram id того, кто вступил по ссылке этой покупки. */
  member?: number;
  /** Доступ снят (возврат): новых ссылок нет. */
  revoked?: string;
};

export function parseInvite(raw: string | null): InviteRecord {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof o.link === "string" && o.link.startsWith("https://") ? { link: o.link } : {}),
      ...(Number.isInteger(o.exp) ? { exp: o.exp as number } : {}),
      ...(typeof o.pending === "string" ? { pending: o.pending } : {}),
      ...(Number.isInteger(o.member) && (o.member as number) > 0
        ? { member: o.member as number }
        : {}),
      ...(typeof o.revoked === "string" ? { revoked: o.revoked } : {}),
    };
  } catch {
    return {};
  }
}

export type InviteResult =
  | { ok: true; link: string }
  | { ok: false; reason: "noChannel" | "busy" | "failed" | "alreadyMember" };

export async function courseChannelInvite(
  ctx: TenantContext,
  p: CoursePurchase,
  access: ChannelAccess,
  now = new Date(),
): Promise<InviteResult> {
  return invite(ctx, p, access, now, CHANNEL_SLOT, p.course.channel);
}

/** Чат потока этой покупки (поток ученика → его группа); нет потока или чата — null. */
export function purchaseChat(
  ctx: TenantContext,
  p: Pick<CoursePurchase, "course" | "run" | "boughtAt" | "variantId">,
  now = new Date(),
): string | null {
  return courseTimeline(p, ctx.timezone, now).cohort?.chat ?? null;
}

/** Личная ссылка в групповой чат потока ученика — по тем же правилам, что в канал. */
export async function courseChatInvite(
  ctx: TenantContext,
  p: CoursePurchase,
  access: ChannelAccess,
  now = new Date(),
): Promise<InviteResult> {
  return invite(ctx, p, access, now, CHAT_SLOT, purchaseChat(ctx, p, now));
}

async function invite(
  ctx: TenantContext,
  p: CoursePurchase,
  access: ChannelAccess,
  now: Date,
  slot: Slot,
  chat: string | null | undefined,
): Promise<InviteResult> {
  if (!chat) return { ok: false, reason: "noChannel" };
  // Канал не входит в тариф или доступ закончился — приглашения нет.
  const tl = courseTimeline(p, ctx.timezone, now);
  if (!tl.tariff.channel || tl.expired) return { ok: false, reason: "noChannel" };
  const key = slot.key(p.orderItemId);
  const t = now.getTime();

  // Уже вступил и всё ещё в канале — вторая ссылка ему не нужна (а другу не положена).
  const before = parseInvite(await getSetting(ctx, key));
  if (before.revoked) return { ok: false, reason: "noChannel" };
  if (before.member && access.isMember) {
    const inside = await access.isMember(chat, before.member);
    if (inside) return { ok: false, reason: "alreadyMember" };
  }

  let claim = "";
  let reuse: string | null = null;
  let busy = false;
  let revoked = false;
  const r = await updateSettingAtomic(ctx, key, (raw) => {
    const cur = parseInvite(raw);
    if (cur.revoked) {
      revoked = true;
      return null;
    }
    // Свежая ссылка, по которой ещё никто не вступал, — отдаём её же.
    if (cur.link && cur.exp && cur.exp * 1000 > t + REUSE_MARGIN_MS && !cur.member) {
      reuse = cur.link;
      return null;
    }
    if (cur.pending && t - Date.parse(cur.pending) < PENDING_MS) {
      busy = true;
      return null;
    }
    claim = JSON.stringify({
      ...(cur.member ? { member: cur.member } : {}),
      pending: now.toISOString(),
    });
    return claim;
  });
  if (revoked) return { ok: false, reason: "noChannel" };
  if (reuse) return { ok: true, link: reuse };
  if (busy) return { ok: false, reason: "busy" };
  if (r !== "written") return { ok: false, reason: "failed" };

  const exp = Math.floor(t / 1000) + INVITE_TTL_S;
  const link = await access.createInvite(chat, `#${p.orderId} ${p.name}`.slice(0, 32), exp);
  if (link) await trySetSetting(ctx, linkKey(link, slot.linkPrefix), p.orderItemId);
  // Итог — поверх своей брони (условие — сама бронь, короткая строка). Сбой
  // Telegram снимает бронь: следующая попытка выпустит ссылку заново.
  const claimed = JSON.parse(claim) as InviteRecord;
  await updateSettingAtomic(ctx, key, (raw) =>
    raw === claim
      ? JSON.stringify({
          ...(claimed.member ? { member: claimed.member } : {}),
          ...(link ? { link, exp } : {}),
        })
      : null,
  );
  return link ? { ok: true, link } : { ok: false, reason: "failed" };
}

/**
 * Событие chat_member: человек вступил в канал по ссылке. Если это
 * приглашение курса — запоминаем, кто вступил (для повторной ссылки и для
 * исключения при возврате). true — ссылка курса нашлась.
 */
export async function recordChannelJoin(
  ctx: TenantContext,
  link: string,
  userId: number,
): Promise<boolean> {
  for (const slot of [CHANNEL_SLOT, CHAT_SLOT]) {
    const itemId = await getSetting(ctx, linkKey(link, slot.linkPrefix));
    if (!itemId) continue;
    await updateSettingAtomic(ctx, slot.key(itemId), (raw) => {
      const cur = parseInvite(raw);
      if (cur.member === userId) return null;
      return JSON.stringify({ ...cur, member: userId });
    });
    return true;
  }
  return false;
}

/**
 * Возврат денег: снять доступ к закрытым каналам курсов заказа — исключить
 * вступившего (или покупателя из Telegram, если событие вступления не
 * дошло), отозвать ссылку и больше не выдавать новых. Отметка «снято»
 * ставится до обращения к Telegram. Возвращает, скольких исключили.
 */
export async function revokeCourseChannels(
  ctx: TenantContext,
  orderId: number,
  access: ChannelAccess,
  now = new Date(),
): Promise<number> {
  return (await revokeCourseChannelsDetailed(ctx, orderId, access, now)).kicked;
}

export type RevokeReport = {
  /** Исключено человек. */
  kicked: number;
  /** Известен, кого исключать, но Telegram не исключил (бот не админ, сбой). */
  failed: number;
};

async function revokeCourseChannelsDetailed(
  ctx: TenantContext,
  orderId: number,
  access: ChannelAccess,
  now: Date,
): Promise<RevokeReport> {
  const report: RevokeReport = { kicked: 0, failed: 0 };
  if (!ctx.tenant.modules.courses) return report;
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("id, platform, telegram_id, created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return report;
  const items = await selectIn<{
    id: string;
    product_id: string | null;
    product_variant_id: string | null;
  }>("позиции заказа", [orderId], (chunk) =>
    ctx.db
      .from("order_items")
      .select("id, product_id, product_variant_id")
      .in("order_id", chunk as number[]),
  );
  for (const it of items) {
    if (!it.product_id) continue;
    const course = parseCourse(await getSetting(ctx, courseKey(it.product_id)));
    const run = parseRun(await getSetting(ctx, runKey(it.id)));
    const targets: Array<[string | null | undefined, Slot]> = [
      [course.channel, CHANNEL_SLOT],
      [
        purchaseChat(
          ctx,
          { course, run, boughtAt: order.created_at, variantId: it.product_variant_id },
          now,
        ),
        CHAT_SLOT,
      ],
    ];
    for (const [chat, slot] of targets) {
      if (!chat) continue;
      const r = await revokeItemChannelDetailed(ctx, it.id, chat, order, access, now, slot);
      if (r === "kicked") report.kicked++;
      else if (r === "failed") report.failed++;
    }
  }
  return report;
}

/**
 * Любой возврат курса (кнопка продавца, возврат от платёжного шлюза): снять
 * доступ и оставить итог в истории заказа — исключили, или Telegram отказал и
 * продавцу надо убрать человека из канала самому. Сбой не бросается: возврат
 * денег уже записан.
 */
export async function revokeChannelsOnRefund(
  ctx: TenantContext,
  orderId: number,
  access: ChannelAccess,
  actor = "admin",
  now = new Date(),
): Promise<RevokeReport> {
  const { recordOrderEvent } = await import("@/core/orders/events");
  let report: RevokeReport;
  try {
    report = await revokeCourseChannelsDetailed(ctx, orderId, access, now);
  } catch (e) {
    console.warn(`[courses] исключение из канала по заказу #${orderId}: ${String(e)}`);
    await recordOrderEvent(ctx, orderId, "channel_revoke_failed", { error: "exception" }, actor);
    return { kicked: 0, failed: 1 };
  }
  if (report.kicked > 0)
    await recordOrderEvent(ctx, orderId, "channel_revoked", { kicked: report.kicked }, actor);
  if (report.failed > 0)
    await recordOrderEvent(ctx, orderId, "channel_revoke_failed", { failed: report.failed }, actor);
  return report;
}

/**
 * Снять доступ одной покупки к каналу: отметка «снято» (условно, до
 * Telegram), отзыв ссылки, исключение вступившего — или покупателя из
 * Telegram, если событие вступления не дошло. true — кого-то исключили.
 */
export async function revokeItemChannel(
  ctx: TenantContext,
  orderItemId: string,
  chat: string,
  order: { platform: string | null; telegram_id: number | null },
  access: ChannelAccess,
  now = new Date(),
  slot: Slot = CHANNEL_SLOT,
): Promise<boolean> {
  return (
    (await revokeItemChannelDetailed(ctx, orderItemId, chat, order, access, now, slot)) === "kicked"
  );
}

export async function revokeItemChannelDetailed(
  ctx: TenantContext,
  orderItemId: string,
  chat: string,
  order: { platform: string | null; telegram_id: number | null },
  access: ChannelAccess,
  now: Date,
  slot: Slot = CHANNEL_SLOT,
): Promise<"kicked" | "none" | "failed"> {
  let rec: InviteRecord = {};
  const mark = await updateSettingAtomic(ctx, slot.key(orderItemId), (raw) => {
    rec = parseInvite(raw);
    if (rec.revoked) return null;
    const { pending: _pending, ...rest } = rec;
    return JSON.stringify({ ...rest, revoked: now.toISOString() });
  });
  if (mark !== "written") return "none";
  const who =
    rec.member ??
    (order.platform === "telegram" && Number(order.telegram_id) > 0
      ? Number(order.telegram_id)
      : null);
  if (rec.link && access.revokeInvite) await access.revokeInvite(chat, rec.link).catch(() => {});
  if (!who) return "none";
  if (!access.kick) return "failed";
  return (await access.kick(chat, who).catch(() => false)) ? "kicked" : "failed";
}
