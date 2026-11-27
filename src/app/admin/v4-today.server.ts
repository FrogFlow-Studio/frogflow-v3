import type { TenantContext } from "@/core/tenant/resolve.server";
import { postgrestV4Db, type RpcClient, type V4Db, type V4Result } from "@/v4/core/db";
import { lastFulfillmentStep, nextFulfillmentStep, sellerReply } from "@/v4/core/depth";
import {
  addLesson,
  advanceFulfillment,
  listLessons,
  savePaymentMethod,
  saveProduct,
  sellerDesk,
  stocktake,
  type LessonRow,
  type ListedProduct,
  type PaymentMethodRow,
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
  paidMinor: number;
  dueMinor: number;
  moneyState: "unpaid" | "partial" | "paid" | "overpaid";
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
      methods: PaymentMethodRow[];
      lessons: LessonRow[];
      sales: SalesDay[];
    };

const MONEY = ["unpaid", "partial", "paid", "overpaid"] as const;

function moneyState(s: string): DeskOrder["moneyState"] {
  return (MONEY as readonly string[]).includes(s) ? (s as DeskOrder["moneyState"]) : "unpaid";
}

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
      paidMinor: o.paidMinor,
      dueMinor: o.dueMinor,
      moneyState: moneyState(o.moneyState),
      nextStep: nextFulfillmentStep(
        await lastFulfillmentStep(db, { botId: ctx.tenant.id, orderId: o.orderId }),
      ),
    })),
  );
  return {
    state: "ready",
    screen: desk.day,
    orders,
    products: desk.products,
    methods: desk.methods,
    lessons: desk.lessons,
    sales: desk.sales,
  };
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

export async function saveV4Product(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: {
    title: string;
    kind: "file" | "club";
    priceMinor: number;
    description?: string | null;
    productId?: string | null;
    trackStock?: boolean;
  },
  db: V4Db = v4DbOf(ctx),
): Promise<V4Result<string>> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "shop_not_found" };
  return saveProduct(db, { botId: ctx.tenant.id, ...input });
}

/** Инвентаризация. Повтор с тем же ключом склад второй раз не двигает. */
export async function stocktakeV4(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { productId: string; target: number; externalRef: string; by: string },
  db: V4Db = v4DbOf(ctx),
): Promise<V4Result<number>> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "shop_not_found" };
  return stocktake(db, { botId: ctx.tenant.id, ...input });
}

/** Следующий урок клуба. Позиция — следующая свободная, покупатель отмечает прохождение сам. */
export async function addV4Lesson(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: { productId: string; title: string },
  db: V4Db = v4DbOf(ctx),
): Promise<V4Result<string>> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "shop_not_found" };
  const lessons = await listLessons(db, ctx.tenant.id);
  const position =
    lessons
      .filter((l) => l.productId === input.productId)
      .reduce((m, l) => Math.max(m, l.position), 0) + 1;
  return addLesson(db, {
    botId: ctx.tenant.id,
    productId: input.productId,
    title: input.title,
    position,
  });
}

export async function saveV4Method(
  ctx: Pick<TenantContext, "db" | "tenant">,
  input: {
    kind: string;
    country: string | null;
    currency: string;
    details: string;
    methodId?: string | null;
  },
  db: V4Db = v4DbOf(ctx),
): Promise<V4Result<string>> {
  if (!(await shopReady(db, ctx.tenant.id))) return { ok: false, code: "shop_not_found" };
  return savePaymentMethod(db, { botId: ctx.tenant.id, ...input });
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
