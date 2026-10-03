import { createHash } from "node:crypto";
import { pageAll } from "@/core/db/page";
import { getSetting } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { serverFailure } from "@/lib/server-failure";
import { courseTimeline } from "./cohort";
import { COURSE_KEY_PREFIX, courseKey, parseCourse } from "./course";
import { readSettings, selectIn } from "./db.server";
import { CHANNEL_SLOT, CHAT_SLOT, type ChannelAccess } from "./channel.server";
import { parseRun, runKey } from "./run.server";

/**
 * Сверка «в канале, но без доступа» (ниша «Онлайн-школа») — для канала курса
 * и для групповых чатов потоков. Telegram не отдаёт
 * ботам список участников, поэтому знаем только тех, чьё вступление бот видел
 * (событие chat_member): по строке `course_seen_<канал>_<id>` на человека.
 * Вышел, исключён или стал администратором — строка удаляется. Тот, кого
 * бот не видел (вступил до подключения бота), в списке не появится.
 */
export const SEEN_KEY_PREFIX = "course_seen_";
const chanTag = (channel: string) =>
  createHash("sha256").update(channel.trim().toLowerCase()).digest("hex").slice(0, 16);
const seenPrefix = (channel: string) => `${SEEN_KEY_PREFIX}${chanTag(channel)}_`;
const seenKey = (channel: string, userId: number) => `${seenPrefix(channel)}${userId}`;

const COURSE_KEY_RE = new RegExp(
  `^${COURSE_KEY_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`,
);

/**
 * Что охраняет чат: канал курса (cohortId = null) или групповой чат потока
 * (тогда положено быть только ученикам этого потока).
 */
type Guard = { productId: string; cohortId: string | null };

/** Настроенные чаты курсов магазина — каналы и чаты потоков: чат → что охраняет. */
async function courseChannels(ctx: TenantContext): Promise<Map<string, Guard[]>> {
  const keys = await pageAll<{ key: string }>(
    (from, to) =>
      ctx.db
        .from("app_settings")
        .select("key")
        .like("key", `${COURSE_KEY_PREFIX}%`)
        .order("key")
        .range(from, to),
    "курсы магазина",
  );
  const out = new Map<string, Guard[]>();
  const add = (chat: string | null | undefined, g: Guard) => {
    if (chat) out.set(chat, [...(out.get(chat) ?? []), g]);
  };
  for (const k of keys) {
    const id = COURSE_KEY_RE.exec(k.key)?.[1];
    if (!id) continue;
    const course = parseCourse(await getSetting(ctx, k.key));
    add(course.channel, { productId: id, cohortId: null });
    for (const c of course.cohorts ?? []) add(c.chat, { productId: id, cohortId: c.id });
  }
  return out;
}

type ChatRef = { id: number; username?: string };

/** Какой из настроенных каналов — это чат события (по числовому id или @имени). */
function matchChannel(channels: Iterable<string>, chat: ChatRef): string | null {
  for (const c of channels) {
    if (c === String(chat.id)) return c;
    if (chat.username && c.toLowerCase() === `@${chat.username.toLowerCase()}`) return c;
  }
  return null;
}

/**
 * Событие chat_member: запомнить вступившего в канал курса (по любой
 * ссылке или без неё) или забыть вышедшего. Чужие чаты и боты пропускаем.
 */
export async function recordChannelSighting(
  ctx: TenantContext,
  chat: ChatRef,
  userId: number,
  status: string,
  who: { name?: string; isBot?: boolean } = {},
  now = new Date(),
): Promise<void> {
  const channel = matchChannel((await courseChannels(ctx)).keys(), chat);
  if (!channel) return;
  const key = seenKey(channel, userId);
  if (["member", "restricted"].includes(status) && !who.isBot) {
    const value = JSON.stringify({ at: now.toISOString(), name: (who.name ?? "").slice(0, 80) });
    const { error } = await ctx.db
      .from("app_settings")
      .upsert(
        { bot_id: ctx.tenant.id, key, value, updated_at: now.toISOString() },
        { onConflict: "bot_id,key" },
      );
    if (error) throw serverFailure(`Вступивший в канал не записан: ${error.message}`);
    return;
  }
  const { error } = await ctx.db.from("app_settings").delete().eq("key", key);
  if (error) throw serverFailure(`Вышедший из канала не снят со списка: ${error.message}`);
}

export type ChannelStranger = {
  channel: string;
  userId: number;
  name: string;
  joinedAt: string;
};

/**
 * Кому в канале или чате потока положено быть: купил, заказ выдан, доступ не
 * снят и не кончился (для чата потока — и покупка в этом потоке).
 */
async function authorizedMembers(
  ctx: TenantContext,
  guards: readonly Guard[],
  now: Date,
): Promise<Set<number>> {
  const ok = new Set<number>();
  for (const { productId, cohortId } of guards) {
    const slot = cohortId ? CHAT_SLOT : CHANNEL_SLOT;
    const course = parseCourse(await getSetting(ctx, courseKey(productId)));
    const items = await pageAll<{
      id: string;
      order_id: number;
      product_variant_id: string | null;
    }>(
      (from, to) =>
        ctx.db
          .from("order_items")
          .select("id, order_id, product_variant_id")
          .eq("product_id", productId)
          .order("id")
          .range(from, to),
      "покупки курса",
    );
    if (!items.length) continue;
    const orders = await selectIn<{
      id: number;
      created_at: string;
      platform: string | null;
      telegram_id: number | null;
    }>(
      "заказы учеников",
      items.map((i) => i.order_id),
      (chunk) =>
        ctx.db
          .from("orders")
          .select("id, created_at, platform, telegram_id")
          .in("id", chunk as number[])
          .eq("status", "delivered"),
    );
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const bought = items.filter((i) => orderById.has(i.order_id));
    const runs = await readSettings(
      ctx,
      bought.map((i) => runKey(i.id)),
    );
    const invs = await readSettings(
      ctx,
      bought.map((i) => slot.key(i.id)),
    );
    for (const i of bought) {
      const o = orderById.get(i.order_id)!;
      let inv: { member?: number; revoked?: string } = {};
      try {
        inv = JSON.parse(invs.get(slot.key(i.id)) ?? "{}") as typeof inv;
      } catch {
        /* битая запись — как нет */
      }
      if (inv.revoked) continue;
      const tl = courseTimeline(
        {
          course,
          run: parseRun(runs.get(runKey(i.id))),
          boughtAt: o.created_at,
          variantId: i.product_variant_id ?? null,
        },
        ctx.timezone,
        now,
      );
      if (tl.expired || !tl.tariff.channel) continue;
      if (cohortId && tl.cohort?.id !== cohortId) continue;
      if (inv.member) ok.add(inv.member);
      if (o.platform === "telegram" && Number(o.telegram_id) > 0) ok.add(Number(o.telegram_id));
    }
  }
  return ok;
}

/** Видимые боту участники канала без действующего доступа. Только чтение. */
export async function channelStrangers(
  ctx: TenantContext,
  now = new Date(),
): Promise<ChannelStranger[]> {
  const out: ChannelStranger[] = [];
  for (const [channel, guards] of await courseChannels(ctx)) {
    const prefix = seenPrefix(channel);
    const seen = await pageAll<{ key: string; value: string | null }>(
      (from, to) =>
        ctx.db
          .from("app_settings")
          .select("key, value")
          .like("key", `${prefix}%`)
          .order("key")
          .range(from, to),
      "вступившие в канал",
    );
    if (!seen.length) continue;
    const allowed = await authorizedMembers(ctx, guards, now);
    for (const row of seen) {
      const userId = Number(row.key.slice(prefix.length));
      if (!Number.isSafeInteger(userId) || userId <= 0 || allowed.has(userId)) continue;
      let v: { at?: string; name?: string } = {};
      try {
        v = JSON.parse(row.value ?? "{}") as typeof v;
      } catch {
        /* битая запись — без имени */
      }
      out.push({ channel, userId, name: v.name ?? "", joinedAt: v.at ?? "" });
    }
  }
  return out.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.userId - b.userId);
}

/**
 * Исключить постороннего из канала. Список пересчитывается заново: ученик,
 * который успел купить доступ, пока продавец смотрел старый список, не
 * исключается. true — исключён.
 */
export async function kickChannelStranger(
  ctx: TenantContext,
  channel: string,
  userId: number,
  access: ChannelAccess,
  now = new Date(),
): Promise<{ kicked: boolean }> {
  const still = (await channelStrangers(ctx, now)).some(
    (s) => s.channel === channel && s.userId === userId,
  );
  if (!still || !access.kick) return { kicked: false };
  if (!(await access.kick(channel, userId).catch(() => false))) return { kicked: false };
  await ctx.db.from("app_settings").delete().eq("key", seenKey(channel, userId));
  return { kicked: true };
}
