import type { TenantContext } from "@/core/tenant/resolve.server";
import { parseKnowledge } from "@/core/consultant/knowledge";
import { parseProfile } from "@/core/consultant/profile";
import { pageAll } from "@/core/db/page";
import { serverFailure } from "@/lib/server-failure";
import type { V4Db } from "../core/db";
import type { V3Snapshot } from "./plan";

/**
 * Снимок v3 для переноса (Спецификация, раздел 3): анкета и знания
 * консультанта, флажки фонового ИИ, остаток ИИ, история консультанта, блоки,
 * карточки товаров (описание, ключевые слова, фото).
 * Только чтение v3; каталог берётся из v4 (уже перенесён copy_from_public).
 * Каждая ошибка чтения — сбой, а не «пусто»: перенос по упавшему чтению
 * молча потерял бы данные.
 */

/** Ключи app_settings, которые читает перенос (флажки — как есть). */
export const V3_TRANSFER_KEYS = [
  "consultant_profile",
  "consultant_knowledge",
  "consultant_enabled",
  "inbox_triage_daily_usd",
  "country_ai",
  "country_ai_daily_usd",
  "postpay_ai",
  "postpay_ai_daily_usd",
  "ai_balance",
  "shop_name",
] as const;

export async function readV3Snapshot(
  ctx: Pick<TenantContext, "db" | "tenant">,
  v4: V4Db,
): Promise<V3Snapshot> {
  const settings: Record<string, string | null> = {};
  const rows = await pageAll<{ key: string; value: string | null }>(
    (from, to) => ctx.db.from("app_settings").select("key, value").order("key").range(from, to),
    "перенос v3: app_settings",
  );
  for (const r of rows) {
    if ((V3_TRANSFER_KEYS as readonly string[]).includes(r.key) || r.key.startsWith("chat_"))
      settings[r.key] = r.value;
  }

  const shopName = settings.shop_name ?? ctx.tenant.id;
  const profile = settings.consultant_profile
    ? parseProfile(settings.consultant_profile, shopName)
    : null;
  const knowledge = parseKnowledge(settings.consultant_knowledge);
  let balanceUsd: number | null = null;
  if (settings.ai_balance) {
    const usd = Number((JSON.parse(settings.ai_balance) as { usd?: unknown }).usd);
    if (!Number.isFinite(usd)) throw serverFailure("перенос v3: испорчен ai_balance");
    balanceUsd = usd;
  }

  const users = await pageAll<{ user_key: string; telegram_id: number; state: unknown }>(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("user_key, telegram_id, state")
        .order("user_key")
        .range(from, to),
    "перенос v3: bot_users",
  );
  const histories: V3Snapshot["histories"] = [];
  for (const u of users) {
    const c = (u.state as { consultant?: { recent?: unknown } } | null)?.consultant;
    const recent = Array.isArray(c?.recent) ? (c.recent as Array<Record<string, unknown>>) : [];
    const msgs = recent
      .filter(
        (m) => (m.role === "customer" || m.role === "assistant") && typeof m.text === "string",
      )
      .map((m) => ({ role: m.role as "customer" | "assistant", text: String(m.text) }));
    if (msgs.length && u.telegram_id > 0)
      histories.push({ telegramId: String(u.telegram_id), recent: msgs });
  }

  const blocked = await pageAll<{ telegram_id: number }>(
    (from, to) =>
      ctx.db
        .from("blocked_users")
        .select("telegram_id")
        .order("bot_id")
        .order("telegram_id")
        .range(from, to),
    "перенос v3: blocked_users",
  );

  // keywords в типах базы — строка, в базе — text[]: разбираем как unknown.
  const v3Rows = await pageAll<{ id: string; description: string; keywords: string }>(
    (from, to) =>
      ctx.db.from("products").select("id, description, keywords").order("id").range(from, to),
    "перенос v3: products",
  );
  const images = await pageAll<{
    product_id: string;
    image_path: string;
    sort_order: number | null;
  }>(
    (from, to) =>
      ctx.db
        .from("product_images")
        .select("id, product_id, image_path, sort_order")
        .order("id")
        .range(from, to),
    "перенос v3: product_images",
  );
  const photos = new Map<string, Array<{ path: string; order: number }>>();
  for (const i of images) {
    if (!i.image_path) continue;
    const list = photos.get(i.product_id) ?? [];
    list.push({ path: i.image_path, order: i.sort_order ?? 0 });
    photos.set(i.product_id, list);
  }

  const catalog = await v4.call("transfer_catalog", { p_bot_id: ctx.tenant.id });
  return {
    profile,
    knowledge,
    settings,
    balanceUsd,
    products: catalog.map((r) => ({
      id: String(r.product_id),
      title: String(r.title),
      variantLabel: (r.variant_label as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      keywords: (r.keywords as string[] | null) ?? [],
    })),
    v3Products: v3Rows.map((p) => ({
      id: String(p.id),
      description: p.description ?? null,
      keywords: Array.isArray(p.keywords as unknown)
        ? (p.keywords as unknown as unknown[]).map(String)
        : [],
      photos: (photos.get(p.id) ?? []).sort((a, b) => a.order - b.order).map((x) => x.path),
    })),
    histories,
    blockedTelegramIds: blocked.map((b) => String(b.telegram_id)),
  };
}
