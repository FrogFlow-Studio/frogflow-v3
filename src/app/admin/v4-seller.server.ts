import type { TenantContext } from "@/core/tenant/resolve.server";
import type { V4Db } from "@/v4/core/db";
import type { SellerProfile } from "@/v4/seller/prompt";
import { saveSellerSettings, sellerSettings, type SellerSettings } from "@/v4/seller/settings";
import { v4DbOf } from "./v4-today.server";

/** Связка панели с настройками ИИ-продавца в v4 (как «Сегодня (v4)», v4-today.server). */

export type V4SellerView =
  { state: "not_connected" } | { state: "no_shop" } | { state: "ready"; settings: SellerSettings };

const SCHEMA_NOT_EXPOSED = /schema must be one of|PGRST106/i;

export async function loadV4Seller(
  ctx: Pick<TenantContext, "db" | "tenant">,
  db: V4Db = v4DbOf(ctx),
): Promise<V4SellerView> {
  let s: SellerSettings | null;
  try {
    s = await sellerSettings(db, ctx.tenant.id);
  } catch (e) {
    if (e instanceof Error && SCHEMA_NOT_EXPOSED.test(e.message)) return { state: "not_connected" };
    throw e;
  }
  return s ? { state: "ready", settings: s } : { state: "no_shop" };
}

export function saveV4Seller(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { profile: SellerProfile; spamWords: string[]; version: string },
  db: V4Db = v4DbOf(ctx),
) {
  return saveSellerSettings(db, { botId: ctx.tenant.id, ...input });
}
