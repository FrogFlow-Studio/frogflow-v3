import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { takeTurn } from "../agent/conversation";
import { openCase } from "./cases/cases";
import { V4_REFUSALS } from "./db";
import {
  acceptExamCandidate,
  catalogSearchMode,
  claimInbound,
  findProductsWide,
  lastFulfillmentStep,
  listExamCandidates,
  readValueReport,
  readWalletDrift,
  sellerReply,
} from "./depth";
import {
  addLesson,
  advanceFulfillment,
  completeLesson,
  enqueueBroadcast,
  enterGiveaway,
  moveStock,
  placeOrder,
  recordGatewayPayment,
  saveProduct,
  touchBuyer,
} from "./platform";
import { pgliteV4, v4Db } from "../test/pg";
import { PANEL_TEXTS } from "../screens/panel-texts";
import { storefrontT } from "@/app/i18n/storefront";

const A = "cccccccc-0000-4000-8000-0000000000c4";
const GIVEAWAY = "dddddddd-0000-4000-8000-0000000000d4";

let pg: PGlite;
const svc = () => pgliteV4(pg);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => pg.close());

describe("глубина", () => {
  it("повтор оплаты, склада, шага, урока, розыгрыша, рассылки и хода — один раз", async () => {
    const saved = await saveProduct(svc(), {
      botId: A,
      title: "Тетрадь",
      kind: "file",
      priceMinor: 50_000,
      description: "клетка",
      trackStock: true,
    });
    if (!saved.ok) throw new Error(saved.code);
    const seeded = await moveStock(svc(), {
      botId: A,
      productId: saved.value,
      delta: 10,
      reason: "receipt",
      externalRef: "seed",
      by: "test",
    });
    if (!seeded.ok) throw new Error(seeded.code);
    const buyerId = await touchBuyer(svc(), {
      botId: A,
      channel: "web",
      externalId: "depth-1",
      country: "KZ",
    });
    const order = await placeOrder(svc(), {
      botId: A,
      buyerId,
      country: "KZ",
      productIds: [saved.value],
      by: "test",
    });
    if (!order.ok) throw new Error(order.code);
    const pay = (ref: string) =>
      recordGatewayPayment(svc(), {
        botId: A,
        orderId: order.value.id,
        gateway: "stripe",
        amountMinor: 50_000,
        currency: "KZT",
        externalRef: ref,
        by: "stripe",
      });
    const [p1, p2] = await Promise.all([pay("pi-race"), pay("pi-race")]);
    if (!p1.ok || !p2.ok) throw new Error("pay");
    expect([p1.value.duplicate, p2.value.duplicate].sort()).toEqual([false, true]);

    const move = () =>
      moveStock(svc(), {
        botId: A,
        productId: saved.value,
        delta: 3,
        reason: "receipt",
        externalRef: "in-1",
        by: "test",
      });
    const [m1, m2] = await Promise.all([move(), move()]);
    if (!m1.ok || !m2.ok) throw new Error("stock");
    const moves = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.stock_moves where bot_id = $1 and external_ref = 'in-1'",
      [A],
    );
    expect(moves.rows[0]!.n).toBe(1);

    const step = () =>
      advanceFulfillment(svc(), {
        botId: A,
        orderId: order.value.id,
        step: "accepted",
        by: "seller",
      });
    const [s1, s2] = await Promise.all([step(), step()]);
    const oks = [s1, s2].filter((r) => r.ok);
    const bads = [s1, s2].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(bads[0] && "code" in bads[0] ? bads[0].code : "").toBe("bad_step");
    expect(await lastFulfillmentStep(svc(), { botId: A, orderId: order.value.id })).toBe(
      "accepted",
    );

    const course = await saveProduct(svc(), {
      botId: A,
      title: "Курс",
      kind: "club",
      priceMinor: 20_000,
      description: "урок",
    });
    if (!course.ok) throw new Error(course.code);
    const lesson = await addLesson(svc(), {
      botId: A,
      productId: course.value,
      title: "Урок 1",
      position: 1,
    });
    if (!lesson.ok) throw new Error(lesson.code);
    await pg.query(
      `insert into v4.access (bot_id, buyer_id, product_id, kind, status, source, starts_at, ends_at, created_by)
       values ($1, $2, $3, 'club', 'active', 'manual', now(), now() + interval '30 days', 'test')`,
      [A, buyerId, course.value],
    );
    const done = () => completeLesson(svc(), { botId: A, buyerId, lessonId: lesson.value });
    const [l1, l2] = await Promise.all([done(), done()]);
    if (!l1.ok || !l2.ok) throw new Error("lesson");
    expect([l1.value, l2.value].sort()).toEqual([false, true]);

    const give = () => enterGiveaway(svc(), { botId: A, giveawayId: GIVEAWAY, buyerId });
    const [g1, g2] = await Promise.all([give(), give()]);
    expect([g1, g2].sort()).toEqual([false, true]);

    const cast = () =>
      enqueueBroadcast(svc(), { botId: A, dedupeKey: "news-1", text: "привет", by: "seller" });
    const [b1, b2] = await Promise.all([cast(), cast()]);
    if (!b1.ok || !b2.ok) throw new Error("broadcast");
    expect([b1.value, b2.value].sort()).toEqual([false, true]);

    const turn = "eeeeeeee-0000-4000-8000-0000000000e1";
    const [t1, t2] = await Promise.all([
      takeTurn(svc(), { botId: A, buyerId, turnId: turn }),
      takeTurn(svc(), { botId: A, buyerId, turnId: turn }),
    ]);
    expect([t1, t2].sort()).toEqual([false, true]);

    const claim = () => claimInbound(svc(), { botId: A, channel: "telegram", externalId: "up-1" });
    const [c1, c2] = await Promise.all([claim(), claim()]);
    expect([c1, c2].sort()).toEqual([false, true]);
  });

  it("ответ продавца один на дело, закрытое дело отказывает кодом из базы", async () => {
    expect(V4_REFUSALS).toContain("reply_closed");
    const src = await pg.query<{ src: string }>(
      "select prosrc src from pg_proc where proname = 'seller_reply'",
    );
    expect(src.rows[0]!.src).toContain("v4:reply_closed");
    const check = await pg.query<{ def: string }>(
      `select pg_get_constraintdef(oid) def from pg_constraint
        where conrelid = 'v4.seller_replies'::regclass and contype = 'c'`,
    );
    expect(check.rows.some((r) => r.def.includes("length"))).toBe(true);
    const opened = await openCase(svc(), {
      botId: A,
      kind: "handoff",
      dedupeKey: "hand-depth",
      by: "test",
    });
    if (!opened.ok) throw new Error(opened.code);
    const first = await sellerReply(svc(), {
      botId: A,
      caseId: opened.value.caseId,
      text: "Файл уже в чате",
      by: "seller",
    });
    const second = await sellerReply(svc(), {
      botId: A,
      caseId: opened.value.caseId,
      text: "Ещё раз",
      by: "seller",
    });
    if (!first.ok || !second.ok) throw new Error("reply");
    expect(first.value).toBe(true);
    expect(second.value).toBe(false);
    await pg.query(
      "update v4.cases set status = 'closed', closed_at = now(), close_note = 'закрыто' where id = $1",
      [opened.value.caseId],
    );
    const closed = await sellerReply(svc(), {
      botId: A,
      caseId: opened.value.caseId,
      text: "После закрытия",
      by: "seller",
    });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe("reply_closed");
  });

  it("поиск без расширения — одна опечатка, в SQL уже есть триграммы", async () => {
    expect(await catalogSearchMode(svc())).toBe("typo");
    const wide = await findProductsWide(svc(), { botId: A, query: "тетрадь" });
    const plain = await pg.query<{ id: string }>(
      "select product_id id from v4.find_products($1, 'тетрадь', 8)",
      [A],
    );
    expect(wide.map((p) => p.productId)).toEqual(plain.rows.map((r) => r.id));
    expect(readFileSync("migrations/v4/025-depth.sql", "utf8")).toContain("similarity(");
    let trgm = false;
    try {
      await pg.exec("create extension if not exists pg_trgm");
      trgm = true;
    } catch {
      trgm = false;
    }
    if (trgm) expect(await catalogSearchMode(svc())).toBe("trgm");
    else expect(await catalogSearchMode(svc())).toBe("typo");
  });

  it("кандидат экзамена принимается один раз, сводка читается без пополнения", async () => {
    const opened = await openCase(svc(), {
      botId: A,
      kind: "handoff",
      dedupeKey: "exam-1",
      by: "test",
    });
    if (!opened.ok) throw new Error(opened.code);
    await pg.query(
      `insert into v4.exam_candidates (bot_id, case_id, question, answer)
       values ($1, $2, 'Где файл?', 'В чате')`,
      [A, opened.value.caseId],
    );
    const list = await listExamCandidates(svc(), A);
    expect(list).toHaveLength(1);
    expect(list[0]!.accepted).toBe(false);
    const once = await acceptExamCandidate(svc(), { botId: A, id: list[0]!.id });
    const twice = await acceptExamCandidate(svc(), { botId: A, id: list[0]!.id });
    if (!once.ok || !twice.ok) throw new Error("exam");
    expect(once.value.already).toBe(false);
    expect(once.value.fixture).toMatchObject({ question: "Где файл?", mode: "recorded" });
    expect(twice.value.already).toBe(true);
    const report = await readValueReport(svc(), {
      botId: A,
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-12-31T00:00:00Z"),
    });
    expect(report.ordersPaid).toBeGreaterThanOrEqual(0);
    expect(typeof (await readWalletDrift(svc(), A))).toBe("number");
  });

  it("новые строки продавца и покупателя есть на четырёх языках", () => {
    for (const k of ["deskOrders", "deskCatalog", "deskSales", "deskStep", "deskReply"] as const) {
      const v = PANEL_TEXTS[k];
      expect(v.kk).not.toBe(v.en);
      expect(v.uz).not.toBe(v.ru);
    }
    const placed = (l: "ru" | "kk" | "en" | "uz") => storefrontT(l)("checkout.v4placed", { no: 7 });
    expect(placed("ru")).toContain("7");
    expect(placed("en")).not.toBe(placed("kk"));
    expect(placed("uz")).not.toBe(placed("ru"));
  });
});
