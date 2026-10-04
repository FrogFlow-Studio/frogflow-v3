import { pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import { UserError } from "@/core/i18n/user-error";
import { getSettingsStrict, updateSettingStamped } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { PURCHASE_STATUSES } from "./card";
import { allSellerNotes } from "./seller-notes";

/**
 * Сохранённые сегменты покупателей («купили 2+ раза», «не покупали 60 дней»,
 * «VIP»): правило + название, список лежит в app_settings `customer_segments`
 * (своей таблицы нет). Это основа для рассылок и акций: правило считается
 * по заказам постранично, без обрезки. Рассылка ничего не отправляет —
 * сегмент только отвечает «кто в него входит».
 */
export type SegmentRule =
  | { kind: "orders_min"; min: number }
  | { kind: "inactive"; days: number }
  | { kind: "tag"; tag: string };

export type CustomerSegment = { id: string; name: string; rule: SegmentRule };

export const SEGMENTS_KEY = "customer_segments";
export const MAX_SEGMENTS = 20;
export const MAX_NAME = 40;
export const SEGMENT_PAGE = 50;

/** Готовые сегменты: показываются всегда, не хранятся. */
export const PRESET_SEGMENTS: readonly CustomerSegment[] = [
  { id: "preset:orders2", name: "orders2", rule: { kind: "orders_min", min: 2 } },
  { id: "preset:inactive60", name: "inactive60", rule: { kind: "inactive", days: 60 } },
  { id: "preset:vip", name: "vip", rule: { kind: "tag", tag: "VIP" } },
];

/** Правило из недоверенного ввода; мусор — null. */
export function parseRule(v: unknown): SegmentRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  switch (r.kind) {
    case "orders_min": {
      const min = Math.floor(Number(r.min));
      return min >= 1 && min <= 1000 ? { kind: "orders_min", min } : null;
    }
    case "inactive": {
      const days = Math.floor(Number(r.days));
      return days >= 1 && days <= 3650 ? { kind: "inactive", days } : null;
    }
    case "tag": {
      const tag = typeof r.tag === "string" ? r.tag.trim().replace(/\s+/g, " ").slice(0, 32) : "";
      return tag ? { kind: "tag", tag } : null;
    }
    default:
      return null;
  }
}

/** Хранимый список: испорченные записи отбрасываются, остальные читаются. */
export function parseSegments(raw: string | null | undefined): CustomerSegment[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: CustomerSegment[] = [];
  for (const s of data) {
    const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const rule = parseRule(o.rule);
    const name = typeof o.name === "string" ? o.name.trim().slice(0, MAX_NAME) : "";
    if (typeof o.id === "string" && o.id && name && rule) out.push({ id: o.id, name, rule });
  }
  return out.slice(0, MAX_SEGMENTS);
}

export async function listSegments(ctx: TenantContext): Promise<CustomerSegment[]> {
  const s = await getSettingsStrict(ctx, [SEGMENTS_KEY]);
  return parseSegments(s[SEGMENTS_KEY]);
}

async function writeList(
  ctx: TenantContext,
  change: (cur: CustomerSegment[]) => CustomerSegment[] | null,
): Promise<void> {
  const r = await updateSettingStamped(ctx, SEGMENTS_KEY, (raw) => {
    const next = change(parseSegments(raw));
    return next ? JSON.stringify(next) : null;
  });
  if (r === "failed") throw serverFailure("Сегменты покупателей: запись не удалась");
}

/** Сохранить сегмент; тот же id — заменить. Условная запись по метке: две вкладки не затрут друг друга. */
export async function saveSegment(
  ctx: TenantContext,
  input: { id?: string; name: string; rule: SegmentRule },
): Promise<string> {
  const name = input.name.trim().slice(0, MAX_NAME);
  if (!name) throw new UserError("err.segment.name", "Дайте сегменту название.");
  const id = input.id ?? crypto.randomUUID();
  let full = false;
  await writeList(ctx, (cur) => {
    full = false;
    const rest = cur.filter((s) => s.id !== id);
    if (rest.length >= MAX_SEGMENTS) {
      full = true;
      return null;
    }
    return [...rest, { id, name, rule: input.rule }];
  });
  if (full)
    throw new UserError(
      "err.segment.limit",
      "Сохранено слишком много сегментов: удалите ненужные.",
    );
  return id;
}

export async function deleteSegment(ctx: TenantContext, id: string): Promise<void> {
  await writeList(ctx, (cur) =>
    cur.some((s) => s.id === id) ? cur.filter((s) => s.id !== id) : null,
  );
}

export type SegmentMember = {
  userKey: string;
  name: string;
  username: string | null;
  platform: string;
  points: number;
  optOut: boolean;
  orders: number;
  lastAt: string | null;
};

/** Покупки по покупателям: число и дата последней. Ключ — user_key заказа, а без него tg_<id>. */
export function purchaseStats(
  rows: Array<{ user_key: string | null; telegram_id: number; created_at: string }>,
): Map<string, { orders: number; lastAt: string }> {
  const out = new Map<string, { orders: number; lastAt: string }>();
  for (const r of rows) {
    const key = r.user_key ?? `tg_${r.telegram_id}`;
    const cur = out.get(key);
    out.set(key, {
      orders: (cur?.orders ?? 0) + 1,
      lastAt: cur && cur.lastAt > r.created_at ? cur.lastAt : r.created_at,
    });
  }
  return out;
}

/** Кто из покупателей подходит правилу по заказам; тег считает вызывающий. */
export function ruleKeys(
  rule: Exclude<SegmentRule, { kind: "tag" }>,
  stats: Map<string, { orders: number; lastAt: string }>,
  now = Date.now(),
): string[] {
  const edge = now - (rule.kind === "inactive" ? rule.days : 0) * 86400_000;
  const out: string[] = [];
  for (const [key, s] of stats) {
    if (rule.kind === "orders_min" ? s.orders >= rule.min : Date.parse(s.lastAt) < edge)
      out.push(key);
  }
  return out;
}

/**
 * Кто входит в сегмент: всего и первые `SEGMENT_PAGE` по user_key (без
 * контактов: имя, канал, баллы). Заказы читаются постранично, покупатели —
 * кусками по 200; кого уже нет в базе покупателей, в сегменте нет.
 */
export async function segmentMembers(
  ctx: TenantContext,
  rule: SegmentRule,
  now = Date.now(),
): Promise<{ total: number; members: SegmentMember[] }> {
  const purchases = await pageAll(
    (from, to) =>
      ctx.db
        .from("orders")
        .select("id, user_key, telegram_id, created_at")
        .in("status", [...PURCHASE_STATUSES])
        .order("id")
        .range(from, to),
    "Сегменты: покупки",
  );
  const stats = purchaseStats(purchases);
  let keys: string[];
  if (rule.kind === "tag") {
    const want = rule.tag.toLowerCase();
    keys = [];
    for (const [key, note] of await allSellerNotes(ctx))
      if (note.tags.some((t) => t.toLowerCase() === want)) keys.push(key);
  } else keys = ruleKeys(rule, stats, now);

  const users = await inChunks(
    keys,
    (chunk) =>
      ctx.db
        .from("bot_users")
        .select("user_key, first_name, last_name, username, platform, loyalty_points, opt_out")
        .in("user_key", chunk)
        .order("user_key"),
    "Сегменты: покупатели",
  );
  users.sort((a, b) => (a.user_key < b.user_key ? -1 : 1));
  return {
    total: users.length,
    members: users.slice(0, SEGMENT_PAGE).map((u) => ({
      userKey: u.user_key,
      name: [u.first_name, u.last_name].filter(Boolean).join(" "),
      username: u.username,
      platform: u.platform ?? "telegram",
      points: Number(u.loyalty_points) || 0,
      optOut: u.opt_out === true,
      orders: stats.get(u.user_key)?.orders ?? 0,
      lastAt: stats.get(u.user_key)?.lastAt ?? null,
    })),
  };
}
