import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addLesson, saveProduct, touchBuyer } from "../core/platform";
import { pgliteV4, v4Db } from "../test/pg";
import { applyShopCarry, planShopCarry, type ShopSnapshot } from "./shop-carry";

const A = "ffffffff-0000-4000-8000-0000000000f6";

let pg: PGlite;
const svc = () => pgliteV4(pg);

beforeAll(async () => {
  pg = await v4Db();
  await pg.query("insert into v4.shops (bot_id, base_currency) values ($1, 'KZT')", [A]);
}, 60_000);
afterAll(async () => pg.close());

describe("вторая опись переноса", () => {
  it("пустая опись всё равно называет каждую область", () => {
    const empty: ShopSnapshot = {
      openOrders: [],
      stock: [],
      discounts: [],
      students: [],
      vip: [],
      broadcasts: [],
      cabinetFiles: [],
    };
    const lines = planShopCarry(empty);
    expect(new Set(lines.map((l) => l.area)).size).toBe(7);
    expect(lines.every((l) => l.action === "check")).toBe(true);
    expect(lines.find((l) => l.area === "orders")!.reason).toContain("оплат");
    expect(lines.find((l) => l.area === "broadcasts")!.reason).toContain("очеред");
  });

  it("склад и VIP переносятся один раз, заказы и рассылки только в отчёте", async () => {
    const saved = await saveProduct(svc(), {
      botId: A,
      title: "Папка",
      kind: "file",
      priceMinor: 10_000,
      description: "синяя",
      trackStock: true,
    });
    if (!saved.ok) throw new Error(saved.code);
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
      title: "Урок",
      position: 1,
    });
    if (!lesson.ok) throw new Error(lesson.code);
    const buyerId = await touchBuyer(svc(), {
      botId: A,
      channel: "telegram",
      externalId: "pupil",
      country: "KZ",
    });
    await pg.query(
      `insert into v4.access (bot_id, buyer_id, product_id, kind, status, source, starts_at, ends_at, created_by)
       values ($1, $2, $3, 'club', 'active', 'manual', now(), now() + interval '30 days', 'test')`,
      [A, buyerId, course.value],
    );
    const stranger = await touchBuyer(svc(), {
      botId: A,
      channel: "telegram",
      externalId: "stranger",
      country: "KZ",
    });
    const snap: ShopSnapshot = {
      openOrders: [{ id: "order-v3-1" }],
      stock: [{ productId: saved.value, onHand: 4 }],
      discounts: [{ id: "sale-10" }],
      students: [
        { buyerId, lessonId: lesson.value },
        { buyerId: stranger, lessonId: lesson.value },
      ],
      vip: [{ chatId: "-100", count: 12 }],
      broadcasts: [{ id: "bcast-1" }],
      cabinetFiles: [{ id: "file-1" }],
    };
    const plan = planShopCarry(snap);
    expect(plan.find((l) => l.area === "orders")!.action).toBe("check");
    expect(plan.find((l) => l.area === "discounts")!.reason).toContain("ценой");
    expect(plan.find((l) => l.area === "cabinet")!.reason).toContain("хранилищ");
    const first = await applyShopCarry(svc(), A, snap);
    const second = await applyShopCarry(svc(), A, snap);
    const onHand = await pg.query<{ n: number }>("select v4.stock_on_hand($1, $2)::int n", [
      A,
      saved.value,
    ]);
    expect(onHand.rows[0]!.n).toBe(4);
    const moves = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.stock_moves where external_ref = $1",
      [`v3-stock:${saved.value}`],
    );
    expect(moves.rows[0]!.n).toBe(1);
    const progress = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.lesson_progress where bot_id = $1",
      [A],
    );
    expect(progress.rows[0]!.n).toBe(1);
    const vip = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.vip_groups where bot_id = $1",
      [A],
    );
    expect(vip.rows[0]!.n).toBe(1);
    const jobs = await pg.query<{ n: number }>(
      "select count(*)::int n from v4.jobs where bot_id = $1 and kind = 'broadcast'",
      [A],
    );
    expect(jobs.rows[0]!.n).toBe(0);
    expect(first.checks.some((l) => l.area === "orders")).toBe(true);
    expect(first.checks.some((l) => l.reason.includes("доступа"))).toBe(true);
    expect(second.checks.some((l) => l.area === "broadcasts")).toBe(true);
    expect(readFileSync("src/v4/transfer/shop-carry.ts", "utf8")).not.toContain("public.");
  });
});
