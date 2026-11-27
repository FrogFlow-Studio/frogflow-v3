import { serverFailure } from "@/lib/server-failure";
import { attempt, type V4Db, type V4Result } from "./db";
import { recordPayment, type Order, type PaymentOutcome } from "./money/money";
import { today, type SellerLang, type TodayScreen } from "../screens/screens";

/**
 * Покупка, склад, школа, VIP, площадка, рассылка и предполёт (migrations/v4/024).
 * Логика в SQL. Этот модуль только вызывает функции.
 * Переключение живого клиента здесь не делается: предполёт говорит, готов ли
 * магазин, флаг served_by ставит оператор отдельным решением.
 */

const GATEWAYS = ["robokassa", "stripe", "kaspi", "prodamus", "nowpayments", "apipay"] as const;
export type Gateway = (typeof GATEWAYS)[number];
export const isGateway = (m: string): m is Gateway => (GATEWAYS as readonly string[]).includes(m);

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const one = (rows: Row[], fn: string): Row => {
  const r = rows[0];
  if (!r) throw serverFailure(`v4.${fn}: пустой ответ`);
  return r;
};
const cell = (row: Row, fn: string) => row[fn];

function toOrder(r: Row): Order {
  return {
    id: String(r.id),
    no: num(r.no),
    buyerId: String(r.buyer_id),
    country: (r.country as string | null) ?? null,
    currency: String(r.currency),
    subtotalMinor: num(r.subtotal_minor),
    pointsUsed: num(r.points_used),
    pointsDiscountMinor: num(r.points_discount_minor),
    totalMinor: num(r.total_minor),
    status: r.status as Order["status"],
    isTest: Boolean(r.is_test),
    expiresAt: new Date(r.expires_at as string | Date),
  };
}

export function touchBuyer(
  db: V4Db,
  input: {
    botId: string;
    channel: "telegram" | "instagram" | "whatsapp" | "web";
    externalId: string;
    now?: Date;
    country?: string | null;
    language?: string | null;
    name?: string | null;
  },
): Promise<string> {
  const args: Record<string, unknown> = {
    p_bot_id: input.botId,
    p_channel: input.channel,
    p_external_id: input.externalId,
    p_country: input.country ?? null,
    p_language: input.language ?? null,
    p_name: input.name ?? null,
  };
  if (input.now) args.p_now = input.now.toISOString();
  return db
    .call("touch_buyer", args)
    .then((rows) => String(cell(one(rows, "touch_buyer"), "touch_buyer")));
}

export async function replyWindowOpen(
  db: V4Db,
  input: { botId: string; channel: string; externalId: string; now?: Date },
): Promise<boolean> {
  const args: Record<string, unknown> = {
    p_bot_id: input.botId,
    p_channel: input.channel,
    p_external_id: input.externalId,
  };
  if (input.now) args.p_now = input.now.toISOString();
  const row = one(await db.call("reply_window_open", args), "reply_window_open");
  return Boolean(cell(row, "reply_window_open"));
}

/** Шлюз пишет в книгу. Повтор того же номера платежа — та же запись. */
export function recordGatewayPayment(
  db: V4Db,
  input: {
    botId: string;
    orderId: string;
    gateway: Gateway;
    amountMinor: number;
    currency: string;
    externalRef: string;
    by: string;
  },
): Promise<V4Result<PaymentOutcome>> {
  return recordPayment(db, {
    botId: input.botId,
    orderId: input.orderId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: input.gateway,
    externalRef: input.externalRef,
    by: input.by,
  });
}

export function saveProduct(
  db: V4Db,
  input: {
    botId: string;
    title: string;
    kind: "file" | "club";
    priceMinor: number;
    description?: string | null;
    productId?: string | null;
    trackStock?: boolean;
  },
): Promise<V4Result<string>> {
  return attempt(async () =>
    String(
      cell(
        one(
          await db.call("save_product", {
            p_bot_id: input.botId,
            p_title: input.title,
            p_kind: input.kind,
            p_price_minor: input.priceMinor,
            p_description: input.description ?? null,
            p_product_id: input.productId ?? null,
            p_track_stock: input.trackStock ?? false,
          }),
          "save_product",
        ),
        "save_product",
      ),
    ),
  );
}

export function moveStock(
  db: V4Db,
  input: {
    botId: string;
    productId: string;
    delta: number;
    reason: "receipt" | "sale" | "writeoff" | "stocktake";
    externalRef: string;
    by: string;
  },
): Promise<V4Result<number>> {
  return attempt(async () =>
    num(
      cell(
        one(
          await db.call("move_stock", {
            p_bot_id: input.botId,
            p_product_id: input.productId,
            p_delta: input.delta,
            p_reason: input.reason,
            p_external_ref: input.externalRef,
            p_created_by: input.by,
          }),
          "move_stock",
        ),
        "move_stock",
      ),
    ),
  );
}

export function stocktake(
  db: V4Db,
  input: { botId: string; productId: string; target: number; externalRef: string; by: string },
): Promise<V4Result<number>> {
  return attempt(async () =>
    num(
      cell(
        one(
          await db.call("stocktake", {
            p_bot_id: input.botId,
            p_product_id: input.productId,
            p_target: input.target,
            p_external_ref: input.externalRef,
            p_created_by: input.by,
          }),
          "stocktake",
        ),
        "stocktake",
      ),
    ),
  );
}

export function placeOrder(
  db: V4Db,
  input: {
    botId: string;
    buyerId: string;
    country: string | null;
    productIds: string[];
    points?: number;
    isTest?: boolean;
    by: string;
  },
): Promise<V4Result<Order>> {
  return attempt(async () =>
    toOrder(
      one(
        await db.call("place_order", {
          p_bot_id: input.botId,
          p_buyer_id: input.buyerId,
          p_country: input.country,
          p_product_ids: input.productIds,
          p_points: input.points ?? 0,
          p_is_test: input.isTest ?? false,
          p_created_by: input.by,
        }),
        "place_order",
      ),
    ),
  );
}

export const FULFILLMENT_STEPS = ["accepted", "working", "ready", "handed"] as const;
export type FulfillmentStep = (typeof FULFILLMENT_STEPS)[number];

export function advanceFulfillment(
  db: V4Db,
  input: { botId: string; orderId: string; step: FulfillmentStep; by: string },
): Promise<V4Result<FulfillmentStep>> {
  return attempt(async () => {
    const step = String(
      cell(
        one(
          await db.call("advance_fulfillment", {
            p_bot_id: input.botId,
            p_order_id: input.orderId,
            p_step: input.step,
            p_created_by: input.by,
          }),
          "advance_fulfillment",
        ),
        "advance_fulfillment",
      ),
    );
    return step as FulfillmentStep;
  });
}

export function addLesson(
  db: V4Db,
  input: { botId: string; productId: string; title: string; position: number },
): Promise<V4Result<string>> {
  return attempt(async () =>
    String(
      cell(
        one(
          await db.call("add_lesson", {
            p_bot_id: input.botId,
            p_product_id: input.productId,
            p_title: input.title,
            p_position: input.position,
          }),
          "add_lesson",
        ),
        "add_lesson",
      ),
    ),
  );
}

export function completeLesson(
  db: V4Db,
  input: { botId: string; buyerId: string; lessonId: string; now?: Date },
): Promise<V4Result<boolean>> {
  const args: Record<string, unknown> = {
    p_bot_id: input.botId,
    p_buyer_id: input.buyerId,
    p_lesson_id: input.lessonId,
  };
  if (input.now) args.p_now = input.now.toISOString();
  return attempt(async () =>
    Boolean(
      cell(one(await db.call("complete_lesson", args), "complete_lesson"), "complete_lesson"),
    ),
  );
}

export function noteVipCount(
  db: V4Db,
  input: { botId: string; chatId: string; count: number; now?: Date },
): Promise<V4Result<number>> {
  const args: Record<string, unknown> = {
    p_bot_id: input.botId,
    p_chat_id: input.chatId,
    p_count: input.count,
  };
  if (input.now) args.p_now = input.now.toISOString();
  return attempt(async () =>
    num(cell(one(await db.call("note_vip_count", args), "note_vip_count"), "note_vip_count")),
  );
}

export async function vipActiveAccess(db: V4Db, botId: string, now?: Date): Promise<number> {
  const args: Record<string, unknown> = { p_bot_id: botId };
  if (now) args.p_now = now.toISOString();
  return num(
    cell(one(await db.call("vip_active_access", args), "vip_active_access"), "vip_active_access"),
  );
}

export function setMarketListing(
  db: V4Db,
  botId: string,
  listed: boolean,
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      cell(
        one(
          await db.call("set_market_listing", { p_bot_id: botId, p_listed: listed }),
          "set_market_listing",
        ),
        "set_market_listing",
      ),
    ),
  );
}

export type MarketProduct = {
  botId: string;
  productId: string;
  title: string;
  priceMinor: number;
  currency: string;
};

export async function marketProducts(db: V4Db, query = ""): Promise<MarketProduct[]> {
  const rows = await db.call("market_products", { p_query: query });
  return rows.map((r) => ({
    botId: String(r.bot_id),
    productId: String(r.product_id),
    title: String(r.title),
    priceMinor: num(r.base_price_minor),
    currency: String(r.currency),
  }));
}

export function enterGiveaway(
  db: V4Db,
  input: { botId: string; giveawayId: string; buyerId: string },
): Promise<boolean> {
  return db
    .call("enter_giveaway", {
      p_bot_id: input.botId,
      p_giveaway_id: input.giveawayId,
      p_buyer_id: input.buyerId,
    })
    .then((rows) => Boolean(cell(one(rows, "enter_giveaway"), "enter_giveaway")));
}

export function joinWaitlist(
  db: V4Db,
  input: { botId: string; productId: string; buyerId: string },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      cell(
        one(
          await db.call("join_waitlist", {
            p_bot_id: input.botId,
            p_product_id: input.productId,
            p_buyer_id: input.buyerId,
          }),
          "join_waitlist",
        ),
        "join_waitlist",
      ),
    ),
  );
}

export function enqueueBroadcast(
  db: V4Db,
  input: { botId: string; dedupeKey: string; text: string; by: string },
): Promise<V4Result<boolean>> {
  return attempt(async () =>
    Boolean(
      cell(
        one(
          await db.call("enqueue_broadcast", {
            p_bot_id: input.botId,
            p_dedupe_key: input.dedupeKey,
            p_text: input.text,
            p_created_by: input.by,
          }),
          "enqueue_broadcast",
        ),
        "enqueue_broadcast",
      ),
    ),
  );
}

export type ListedOrder = {
  orderId: string;
  no: number;
  status: string;
  currency: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  moneyState: string;
};

export async function listOrders(db: V4Db, botId: string): Promise<ListedOrder[]> {
  const rows = await db.call("list_orders", { p_bot_id: botId, p_limit: 50 });
  return rows.map((r) => ({
    orderId: String(r.order_id),
    no: num(r.no),
    status: String(r.status),
    currency: String(r.currency),
    totalMinor: num(r.total_minor),
    paidMinor: num(r.paid_minor),
    dueMinor: num(r.due_minor),
    moneyState: String(r.money_state),
  }));
}

export type ListedProduct = {
  id: string;
  title: string;
  kind: string;
  status: string;
  priceMinor: number;
  description: string | null;
  trackStock: boolean;
  onHand: number;
};

export async function listProducts(db: V4Db, botId: string): Promise<ListedProduct[]> {
  const rows = await db.call("list_products", { p_bot_id: botId });
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    kind: String(r.kind),
    status: String(r.status),
    priceMinor: num(r.base_price_minor),
    description: (r.description as string | null) ?? null,
    trackStock: Boolean(r.track_stock),
    onHand: num(r.on_hand),
  }));
}

export type SalesDay = { day: string; currency: string; amountMinor: number; entries: number };

export async function salesDays(db: V4Db, botId: string): Promise<SalesDay[]> {
  const rows = await db.call("sales_days", { p_bot_id: botId });
  return rows.map((r) => ({
    day: String(r.day).slice(0, 10),
    currency: String(r.currency),
    amountMinor: num(r.amount_minor),
    entries: num(r.entries),
  }));
}

export function recordPlatformPayment(
  db: V4Db,
  input: {
    botId: string;
    invoiceId: string;
    amountMinor: number;
    currency: string;
    externalRef: string;
    by: string;
  },
): Promise<V4Result<{ entryId: number; duplicate: boolean }>> {
  return attempt(async () => {
    const r = one(
      await db.call("record_platform_payment", {
        p_bot_id: input.botId,
        p_invoice_id: input.invoiceId,
        p_amount_minor: input.amountMinor,
        p_currency: input.currency,
        p_external_ref: input.externalRef,
        p_created_by: input.by,
      }),
      "record_platform_payment",
    );
    return { entryId: num(r.entry_id), duplicate: Boolean(r.duplicate) };
  });
}

export type Preflight = {
  blockers: string[];
  warnings: string[];
  products: number;
  methods: number;
  emptyDescriptions: number;
  openCases: number;
};

export async function shopPreflight(db: V4Db, botId: string): Promise<Preflight> {
  const raw = cell(
    one(await db.call("shop_preflight", { p_bot_id: botId }), "shop_preflight"),
    "shop_preflight",
  );
  const r = (typeof raw === "string" ? JSON.parse(raw) : raw) as Preflight;
  return {
    blockers: r.blockers ?? [],
    warnings: r.warnings ?? [],
    products: num(r.products),
    methods: num(r.methods),
    emptyDescriptions: num(
      r.emptyDescriptions ?? (r as { empty_descriptions?: number }).empty_descriptions,
    ),
    openCases: num(r.openCases ?? (r as { open_cases?: number }).open_cases),
  };
}

/** Готовность к замене v3 для одного магазина. Флаг отсюда не пишется. */
export function cutoverDecision(report: Preflight): { ready: boolean } {
  return { ready: report.blockers.length === 0 };
}

export type SellerDesk = {
  day: TodayScreen;
  orders: ListedOrder[];
  products: ListedProduct[];
  sales: SalesDay[];
};

/** День продавца: дела, заказы, каталог и выручка из книги. */
export async function sellerDesk(
  db: V4Db,
  botId: string,
  lang: SellerLang = "ru",
): Promise<SellerDesk> {
  const [day, orders, products, sales] = await Promise.all([
    today(db, botId, lang),
    listOrders(db, botId),
    listProducts(db, botId),
    salesDays(db, botId),
  ]);
  return { day, orders, products, sales };
}
