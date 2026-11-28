import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkout,
  handleTelegramUpdate,
  marketingAllowed,
  parseTelegramUpdate,
} from "../channels/inbound";
import { pgliteV4, v4Db } from "../test/pg";
import {
  addLesson,
  advanceFulfillment,
  completeLesson,
  cutoverDecision,
  enqueueBroadcast,
  enterGiveaway,
  joinWaitlist,
  listProducts,
  marketProducts,
  moveStock,
  noteVipCount,
  placeOrder,
  recordGatewayPayment,
  recordPlatformPayment,
  salesDays,
  saveProduct,
  sellerDesk,
  setMarketListing,
  shopPreflight,
  touchBuyer,
  vipActiveAccess,
} from "./platform";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const GIVEAWAY = "cccccccc-0000-4000-8000-0000000000c3";

let pg: PGlite;
const svc = () => pgliteV4(pg);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => pg.close());

describe("покупка, склад, школа, площадка и предполёт", () => {
  it("пустой магазин нельзя переключать", async () => {
    const report = await shopPreflight(svc(), A);
    expect(report.blockers.sort()).toEqual(["no_payment_method", "no_products"]);
    expect(cutoverDecision(report).ready).toBe(false);
  });

  it("шлюз пишет книгу один раз, повтор вебхука не удваивает оплату", async () => {
    const saved = await saveProduct(svc(), {
      botId: A,
      title: "Тетрадь",
      kind: "file",
      priceMinor: 100_000,
      description: "5 класс",
    });
    if (!saved.ok) throw new Error(saved.code);
    await pg.query(
      "insert into v4.payment_methods (bot_id, kind, currency, details, fee_bp) values ($1, 'stripe', 'KZT', '', 250)",
      [A],
    );
    const buyerId = await touchBuyer(svc(), {
      botId: A,
      channel: "web",
      externalId: "mini-1",
      country: "KZ",
    });
    const order = await placeOrder(svc(), {
      botId: A,
      buyerId,
      country: "KZ",
      productIds: [saved.value],
      by: "web",
    });
    if (!order.ok) throw new Error(order.code);
    const pay = (ref: string) =>
      recordGatewayPayment(svc(), {
        botId: A,
        orderId: order.value.id,
        gateway: "stripe",
        amountMinor: 100_000,
        currency: "KZT",
        externalRef: ref,
        by: "stripe",
      });
    const first = await pay("ch_1");
    const second = await pay("ch_1");
    if (!first.ok || !second.ok) throw new Error("payment");
    expect(first.value.becamePaid).toBe(true);
    expect(first.value.duplicate).toBe(false);
    expect(second.value.duplicate).toBe(true);
    expect(second.value.entryId).toBe(first.value.entryId);
    const fee = await pg.query<{ n: string }>(
      "select count(*)::text n from v4.ledger where order_id = $1 and kind = 'platform_fee'",
      [order.value.id],
    );
    expect(fee.rows[0]!.n).toBe("1");
  });

  it("остаток не уходит в минус, ноль открывает дело", async () => {
    const saved = await saveProduct(svc(), {
      botId: A,
      title: "Букет",
      kind: "file",
      priceMinor: 50_000,
      description: "розы",
      trackStock: true,
    });
    if (!saved.ok) throw new Error(saved.code);
    const stocked = await moveStock(svc(), {
      botId: A,
      productId: saved.value,
      delta: 1,
      reason: "receipt",
      externalRef: "in-1",
      by: "seller",
    });
    if (!stocked.ok) throw new Error(stocked.code);
    expect(stocked.value).toBe(1);
    const buyerId = await touchBuyer(svc(), {
      botId: A,
      channel: "telegram",
      externalId: "42",
      country: "KZ",
    });
    const sold = await placeOrder(svc(), {
      botId: A,
      buyerId,
      country: "KZ",
      productIds: [saved.value],
      by: "telegram",
    });
    if (!sold.ok) throw new Error(sold.code);
    const again = await placeOrder(svc(), {
      botId: A,
      buyerId,
      country: "KZ",
      productIds: [saved.value],
      by: "telegram",
    });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe("stock_negative");
    const cases = await pg.query<{ n: string }>(
      "select count(*)::text n from v4.cases where bot_id = $1 and kind = 'stock_low' and status = 'open'",
      [A],
    );
    expect(cases.rows[0]!.n).toBe("1");
    const steps = ["accepted", "working", "ready", "handed"] as const;
    for (const step of steps) {
      const r = await advanceFulfillment(svc(), {
        botId: A,
        orderId: sold.value.id,
        step,
        by: "seller",
      });
      if (!r.ok) throw new Error(r.code);
    }
    const skip = await advanceFulfillment(svc(), {
      botId: A,
      orderId: sold.value.id,
      step: "accepted",
      by: "seller",
    });
    expect(skip.ok).toBe(false);
  });

  it("урок только при живом доступе, VIP считает доступы, площадка ищет товар", async () => {
    const course = await saveProduct(svc(), {
      botId: A,
      title: "Курс",
      kind: "club",
      priceMinor: 200_000,
      description: "поток",
    });
    if (!course.ok) throw new Error(course.code);
    await pg.query("update v4.products set club_chat_id = $2 where id = $1", [
      course.value,
      "-100",
    ]);
    const lesson = await addLesson(svc(), {
      botId: A,
      productId: course.value,
      title: "Урок 1",
      position: 1,
    });
    if (!lesson.ok) throw new Error(lesson.code);
    const buyerId = await touchBuyer(svc(), {
      botId: A,
      channel: "telegram",
      externalId: "7",
      country: "KZ",
    });
    const denied = await completeLesson(svc(), { botId: A, buyerId, lessonId: lesson.value });
    expect(denied.ok).toBe(false);
    await pg.query(
      `insert into v4.access (bot_id, buyer_id, product_id, kind, status, source, starts_at, ends_at, created_by)
       values ($1, $2, $3, 'club', 'active', 'manual', now(), now() + interval '30 days', 'test')`,
      [A, buyerId, course.value],
    );
    const done = await completeLesson(svc(), { botId: A, buyerId, lessonId: lesson.value });
    if (!done.ok) throw new Error(done.code);
    expect(done.value).toBe(true);
    const again = await completeLesson(svc(), { botId: A, buyerId, lessonId: lesson.value });
    if (!again.ok) throw new Error(again.code);
    expect(again.value).toBe(false);
    const noted = await noteVipCount(svc(), { botId: A, chatId: "-100", count: 12 });
    if (!noted.ok) throw new Error(noted.code);
    expect(await vipActiveAccess(svc(), A)).toBe(1);
    const listed = await setMarketListing(svc(), A, true);
    if (!listed.ok) throw new Error(listed.code);
    const found = await marketProducts(svc(), "Курс");
    expect(found.some((p) => p.productId === course.value)).toBe(true);
    expect(await enterGiveaway(svc(), { botId: A, giveawayId: GIVEAWAY, buyerId })).toBe(true);
    expect(await enterGiveaway(svc(), { botId: A, giveawayId: GIVEAWAY, buyerId })).toBe(false);
    const wait = await joinWaitlist(svc(), { botId: A, productId: course.value, buyerId });
    if (!wait.ok) throw new Error(wait.code);
    expect(wait.value).toBe(true);
    const broadcast = await enqueueBroadcast(svc(), {
      botId: A,
      dedupeKey: "week",
      text: "привет",
      by: "seller",
    });
    const repeat = await enqueueBroadcast(svc(), {
      botId: A,
      dedupeKey: "week",
      text: "привет",
      by: "seller",
    });
    if (!broadcast.ok || !repeat.ok) throw new Error("broadcast");
    expect(broadcast.value).toBe(true);
    expect(repeat.value).toBe(false);
  });

  it("счёт платформы пишется в книгу billing один раз", async () => {
    const inv = await pg.query<{ id: string }>(
      `insert into v4.invoices (bot_id, period, tariff, tariff_minor, currency)
       values ($1, '2026-11-01', 'pro', 1000000, 'KZT') returning id`,
      [A],
    );
    const pay = await recordPlatformPayment(svc(), {
      botId: A,
      invoiceId: inv.rows[0]!.id,
      amountMinor: 1_000_000,
      currency: "KZT",
      externalRef: "inv-1",
      by: "operator",
    });
    const again = await recordPlatformPayment(svc(), {
      botId: A,
      invoiceId: inv.rows[0]!.id,
      amountMinor: 1_000_000,
      currency: "KZT",
      externalRef: "inv-1",
      by: "operator",
    });
    if (!pay.ok || !again.ok) throw new Error("billing");
    expect(pay.value.duplicate).toBe(false);
    expect(again.value.duplicate).toBe(true);
    const book = await pg.query<{ book: string }>("select book from v4.ledger where id = $1", [
      pay.value.entryId,
    ]);
    expect(book.rows[0]!.book).toBe("billing");
  });

  it("день продавца читает заказы и каталог, предполёт без блокеров", async () => {
    const desk = await sellerDesk(svc(), A, "ru");
    expect(desk.orders.length).toBeGreaterThan(0);
    expect(desk.products.length).toBeGreaterThan(0);
    expect(desk.day.botDid.orders).toBeGreaterThan(0);
    const sales = await salesDays(svc(), A);
    expect(sales.some((d) => d.amountMinor > 0)).toBe(true);
    const products = await listProducts(svc(), A);
    expect(products.every((p) => p.description)).toBe(true);
    const report = await shopPreflight(svc(), A);
    expect(report.blockers).toEqual([]);
    expect(cutoverDecision(report).ready).toBe(true);
    expect(report.warnings).toContain("open_cases");
  });
});

describe("каналы", () => {
  it("кнопка Telegram не создаёт заказ сразу, чек садится по хешу файла", async () => {
    const product = (await listProducts(svc(), A)).find((p) => p.title === "Тетрадь");
    if (!product) throw new Error("no product");
    const orders = async () =>
      Number(
        (
          await pg.query<{ n: number }>("select count(*)::int n from v4.orders where bot_id = $1", [
            A,
          ])
        ).rows[0]!.n,
      );
    const before = await orders();
    const bought = await handleTelegramUpdate(svc(), {
      botId: A,
      country: "KZ",
      update: { callback_query: { data: `buy:${product.id}`, message: { chat: { id: 99 } } } },
    });
    expect(bought.type).toBe("ignore");
    expect(await orders()).toBe(before);
    const placed = await checkout(svc(), {
      botId: A,
      channel: "telegram",
      externalId: "99",
      country: "KZ",
      productIds: [product.id],
      by: "test",
    });
    expect(placed.type).toBe("order");
    const bytes = new TextEncoder().encode("чек магазина");
    const { sha256Hex } = await import("@/lib/hash");
    const receipt = await handleTelegramUpdate(svc(), {
      botId: A,
      update: { message: { chat: { id: 99 }, photo: [{ file_id: "ph" }] } },
      loadFile: async () => bytes,
    });
    expect(receipt.type).toBe("receipt");
    const fp = (
      await pg.query<{ fingerprint: string }>(
        "select fingerprint from v4.receipts where bot_id = $1 order by submitted_at desc limit 1",
        [A],
      )
    ).rows[0]!.fingerprint;
    expect(fp).toBe(sha256Hex(bytes));
    expect(fp).not.toBe("ab".repeat(32));
    expect(parseTelegramUpdate({ message: { chat: { id: 1 }, text: "привет" } })).toEqual({
      type: "text",
      chatId: "1",
      text: "привет",
    });
  });

  it("WhatsApp вне 24 часов не принимает маркетинговую отправку, витрина оформляет тот же заказ", async () => {
    const product = (await listProducts(svc(), A)).find((p) => p.title === "Тетрадь");
    if (!product) throw new Error("no product");
    const then = new Date("2026-11-01T00:00:00Z");
    const later = new Date("2026-11-02T01:00:00Z");
    const order = await checkout(svc(), {
      botId: A,
      channel: "whatsapp",
      externalId: "wa-1",
      country: "KZ",
      productIds: [product.id],
      by: "whatsapp",
      now: then,
    });
    expect(order.type).toBe("order");
    expect(
      await marketingAllowed(svc(), {
        botId: A,
        channel: "whatsapp",
        externalId: "wa-1",
        now: later,
      }),
    ).toBe(false);
    expect(
      await marketingAllowed(svc(), {
        botId: A,
        channel: "telegram",
        externalId: "42",
        now: later,
      }),
    ).toBe(true);
    const web = await checkout(svc(), {
      botId: A,
      channel: "web",
      externalId: "storefront-1",
      country: "KZ",
      productIds: [product.id],
      by: "storefront",
    });
    expect(web.type).toBe("order");
  });
});
