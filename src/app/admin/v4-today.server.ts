import type { TenantContext } from "@/core/tenant/resolve.server";
import { postgrestV4Db, type RpcClient, type V4Db, type V4Result } from "@/v4/core/db";
import { lastFulfillmentStep, nextFulfillmentStep, sellerReply } from "@/v4/core/depth";
import {
  advanceFulfillment,
  sellerDesk,
  type ListedProduct,
  type SalesDay,
} from "@/v4/core/platform";
import { caseAction, shopReady, type ActionOutcome, type PanelAction } from "@/v4/screens/actions";
import { type SellerLang, type TodayScreen } from "@/v4/screens/screens";

/**
 * Связка панели v3 со схемой v4 под ролью арендатора (ctx.db): RLS схемы v4
 * отдаёт только строки этого магазина. Схема v4 должна быть в Supabase →
 * Settings → API → Exposed schemas; пока её там нет, PostgREST отвечает
 * PGRST106 — это «v4 не подключена», а не сбой. Любая другая ошибка — сбой.
 */

export type DeskOrder = {
  orderId: string;
  no: number;
  status: string;
  currency: string;
  totalMinor: number;
  dueMinor: number;
  nextStep: "accepted" | "working" | "ready" | "handed" | null;
};

export type V4TodayView =
  | { state: "not_connected" }
  | { state: "no_shop" }
  | {
      state: "ready";
      screen: TodayScreen;
      orders: DeskOrder[];
      products: ListedProduct[];
      sales: SalesDay[];
    };

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
  const desk = await sellerDesk(db, ctx.tenant.id, lang);
  const orders = await Promise.all(
    desk.orders.map(async (o) => ({
      orderId: o.orderId,
      no: o.no,
      status: o.status,
      currency: o.currency,
      totalMinor: o.totalMinor,
      dueMinor: o.dueMinor,
      nextStep: nextFulfillmentStep(
        await lastFulfillmentStep(db, { botId: ctx.tenant.id, orderId: o.orderId }),
      ),
    })),
  );
  return { state: "ready", screen: desk.day, orders, products: desk.products, sales: desk.sales };
}

export async function runV4CaseAction(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { caseId: string; action: PanelAction; reason?: string; by: string },
  db: V4Db = v4DbOf(ctx),
): Promise<ActionOutcome> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "case_not_found" };
  return caseAction(db, { botId: ctx.tenant.id, ...input });
}

/** Следующий шаг физического заказа. После «передан» шага нет. */
export async function advanceV4Order(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { orderId: string; by: string },
  db: V4Db = v4DbOf(ctx),
): Promise<V4Result<string>> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "order_not_found" };
  const next = nextFulfillmentStep(
    await lastFulfillmentStep(db, { botId: ctx.tenant.id, orderId: input.orderId }),
  );
  if (!next) return { ok: false, code: "bad_step" };
  return advanceFulfillment(db, {
    botId: ctx.tenant.id,
    orderId: input.orderId,
    step: next,
    by: input.by,
  });
}

/** Ответ продавца своим текстом. Модель не вызывается. */
export async function replyV4Case(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { caseId: string; text: string; by: string },
  db: V4Db = v4DbOf(ctx),
): Promise<V4Result<boolean> | { ok: false; code: "case_not_found" }> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "case_not_found" };
  return sellerReply(db, { botId: ctx.tenant.id, ...input });
}
