import { createHash } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, trySetSetting, updateSettingAtomic } from "@/core/settings/settings";
import { courseTimeline } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { selectIn } from "./db.server";
import type { CoursePurchase } from "./run.server";

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
const linkKey = (link: string) =>
  `${INVITE_LINK_PREFIX}${createHash("sha256").update(link).digest("hex").slice(0, 24)}`;

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

function parseInvite(raw: string | null): InviteRecord {
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
  const chat = p.course.channel;
  if (!chat) return { ok: false, reason: "noChannel" };
  // Канал не входит в тариф или доступ закончился — приглашения нет.
  const tl = courseTimeline(p, ctx.timezone, now);
  if (!tl.tariff.channel || tl.expired) return { ok: false, reason: "noChannel" };
  const key = inviteKey(p.orderItemId);
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
  if (link) await trySetSetting(ctx, linkKey(link), p.orderItemId);
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
  const itemId = await getSetting(ctx, linkKey(link));
  if (!itemId) return false;
  await updateSettingAtomic(ctx, inviteKey(itemId), (raw) => {
    const cur = parseInvite(raw);
    if (cur.member === userId) return null;
    return JSON.stringify({ ...cur, member: userId });
  });
  return true;
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
  if (!ctx.tenant.modules.courses) return 0;
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("id, platform, telegram_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return 0;
  const items = await selectIn<{ id: string; product_id: string | null }>(
    "позиции заказа",
    [orderId],
    (chunk) =>
      ctx.db
        .from("order_items")
        .select("id, product_id")
        .in("order_id", chunk as number[]),
  );
  let kicked = 0;
  for (const it of items) {
    if (!it.product_id) continue;
    const chat = parseCourse(await getSetting(ctx, courseKey(it.product_id))).channel;
    if (!chat) continue;
    if (await revokeItemChannel(ctx, it.id, chat, order, access, now)) kicked++;
  }
  return kicked;
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
): Promise<boolean> {
  let rec: InviteRecord = {};
  const mark = await updateSettingAtomic(ctx, inviteKey(orderItemId), (raw) => {
    rec = parseInvite(raw);
    if (rec.revoked) return null;
    const { pending: _pending, ...rest } = rec;
    return JSON.stringify({ ...rest, revoked: now.toISOString() });
  });
  if (mark !== "written") return false;
  const who =
    rec.member ??
    (order.platform === "telegram" && Number(order.telegram_id) > 0
      ? Number(order.telegram_id)
      : null);
  if (rec.link && access.revokeInvite) await access.revokeInvite(chat, rec.link).catch(() => {});
  return Boolean(who && access.kick && (await access.kick(chat, who).catch(() => false)));
}
