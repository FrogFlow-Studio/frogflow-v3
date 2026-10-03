import { previewReadonly } from "@/lib/preview";
import { createHash } from "node:crypto";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { env } from "@/config/env";
import { setSetting } from "@/core/settings/settings";
import { sendWebPush, validPushEndpoint, type PushSubscription, type Vapid } from "./webpush";

/**
 * Push-уведомления продавцу в админку как приложение (PWA): подписки
 * браузеров команды магазина — строки app_settings `push_sub:<отпечаток
 * адреса>` (схема не меняется), не больше MAX_DEVICES на магазин. Шлёт их
 * notifyAdminsHtml вместе с Telegram по той же матрице и тихим часам.
 */
export const PUSH_PREFIX = "push_sub:";
export const MAX_DEVICES = 20;

type Stored = PushSubscription & { user: string; at: string };

export function vapidFromEnv(): Vapid | null {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: e.VAPID_PUBLIC_KEY,
    privateKey: e.VAPID_PRIVATE_KEY,
    subject: e.VAPID_SUBJECT || "mailto:support@frogflow.kz",
  };
}

const keyOf = (endpoint: string) =>
  `${PUSH_PREFIX}${createHash("sha256").update(endpoint).digest("hex").slice(0, 24)}`;

export function parseStored(raw: string | null | undefined): Stored | null {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Stored> | null;
    if (!v || typeof v.endpoint !== "string" || !validPushEndpoint(v.endpoint)) return null;
    if (typeof v.p256dh !== "string" || typeof v.auth !== "string") return null;
    return {
      endpoint: v.endpoint,
      p256dh: v.p256dh,
      auth: v.auth,
      user: String(v.user ?? ""),
      at: String(v.at ?? ""),
    };
  } catch {
    return null;
  }
}

async function listStored(ctx: TenantContext): Promise<Array<Stored & { key: string }>> {
  const { data } = await ctx.db
    .from("app_settings")
    .select("key, value")
    .eq("bot_id", ctx.tenant.id)
    .like("key", `${PUSH_PREFIX}%`)
    .limit(100);
  return (data ?? []).flatMap((r) => {
    const s = parseStored(r.value);
    return s ? [{ ...s, key: r.key }] : [];
  });
}

/** Подписка этого браузера; лишние сверх MAX_DEVICES — самые старые — снимаются. */
export async function saveAdminPush(
  ctx: TenantContext,
  sub: PushSubscription,
  user: string,
  now = new Date(),
): Promise<boolean> {
  if (!validPushEndpoint(sub.endpoint)) return false;
  const value: Stored = { ...sub, user, at: now.toISOString() };
  const key = keyOf(sub.endpoint);
  try {
    await setSetting(ctx, key, JSON.stringify(value));
  } catch {
    return false;
  }
  const all = (await listStored(ctx)).sort((a, b) => b.at.localeCompare(a.at));
  for (const old of all.slice(MAX_DEVICES))
    await ctx.db.from("app_settings").delete().eq("bot_id", ctx.tenant.id).eq("key", old.key);
  return true;
}

export async function removeAdminPush(ctx: TenantContext, endpoint: string): Promise<void> {
  await ctx.db.from("app_settings").delete().eq("bot_id", ctx.tenant.id).eq("key", keyOf(endpoint));
}

/** Разослать push на все устройства команды; снятые в браузере подписки удаляются. */
export async function pushAdmins(
  ctx: TenantContext,
  msg: { title: string; body: string; url: string; tag?: string },
  vapid: Vapid | null = vapidFromEnv(),
  send: typeof sendWebPush = sendWebPush,
): Promise<number> {
  if (!vapid || previewReadonly()) return 0;
  const subs = await listStored(ctx);
  let sent = 0;
  for (const s of subs) {
    const r = await send(s, msg, vapid);
    if (r === "sent") sent++;
    else if (r === "gone")
      await ctx.db.from("app_settings").delete().eq("bot_id", ctx.tenant.id).eq("key", s.key);
  }
  return sent;
}

/** Заголовок и текст push из HTML уведомления Telegram: первая строка — заголовок. */
export function pushFromHtml(html: string): { title: string; body: string } {
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
  const [first = "", ...rest] = text.split("\n");
  return { title: first.slice(0, 120) || "FrogFlow", body: rest.join("\n").trim().slice(0, 400) };
}
