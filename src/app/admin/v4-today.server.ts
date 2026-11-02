import type { TenantContext } from "@/core/tenant/resolve.server";
import { postgrestV4Db, type RpcClient, type V4Db } from "@/v4/core/db";
import { caseAction, shopReady, type ActionOutcome, type PanelAction } from "@/v4/screens/actions";
import { today, type SellerLang, type TodayScreen } from "@/v4/screens/screens";

/**
 * Связка панели v3 со схемой v4 под ролью арендатора (ctx.db): RLS схемы v4
 * отдаёт только строки этого магазина. Схема v4 должна быть в Supabase →
 * Settings → API → Exposed schemas; пока её там нет, PostgREST отвечает
 * PGRST106 — это «v4 не подключена», а не сбой. Любая другая ошибка — сбой.
 */

export type V4TodayView =
  { state: "not_connected" } | { state: "no_shop" } | { state: "ready"; screen: TodayScreen };

const SCHEMA_NOT_EXPOSED = /schema must be one of|PGRST106/i;

export function v4DbOf(ctx: Pick<TenantContext, "db">): V4Db {
  return postgrestV4Db(ctx.db as unknown as RpcClient);
}

export async function loadV4Today(
  ctx: Pick<TenantContext, "db" | "tenant">,
  lang: SellerLang,
  db: V4Db = v4DbOf(ctx),
): Promise<V4TodayView> {
  let ready: boolean;
  try {
    ready = await shopReady(db, ctx.tenant.id);
  } catch (e) {
    if (e instanceof Error && SCHEMA_NOT_EXPOSED.test(e.message)) return { state: "not_connected" };
    throw e;
  }
  if (!ready) return { state: "no_shop" };
  return { state: "ready", screen: await today(db, ctx.tenant.id, lang) };
}

export async function runV4CaseAction(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { caseId: string; action: PanelAction; reason?: string; by: string },
  db: V4Db = v4DbOf(ctx),
): Promise<ActionOutcome> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "case_not_found" };
  return caseAction(db, { botId: ctx.tenant.id, ...input });
}
