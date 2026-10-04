import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { postReceipt, loadReceipt } from "./receipts";
import { receiptFromRequest } from "./request-receive";
import {
  buildSuggestions,
  closeRequestByReceipt,
  createRequest,
  deleteRequest,
  listRequests,
  loadRequest,
  markOrdered,
  requestCsv,
  requestText,
  suggestQty,
  suggestRequests,
  updateRequest,
} from "./requests";

const BOT = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-10-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const P4 = "44444444-4444-4444-8444-444444444444";
const S1 = "55555555-5555-4555-8555-555555555555";
const S2 = "66666666-6666-4666-8666-666666666666";

const prod = (id: string, name: string, stock: number | null) => ({
  id,
  bot_id: BOT,
  name,
  is_active: true,
  fulfillment_kind: "physical",
  stock_quantity: stock,
});

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    { bot_id: BOT, key: "shop_currency", value: "KZT" },
    { bot_id: BOT, key: "low_stock_default", value: "5" },
    {
      bot_id: BOT,
      key: "suppliers",
      value: JSON.stringify({
        rev: 1,
        items: [
          { id: S1, name: "Мука-Опт", contact: "Айгуль", phone: "", note: "" },
          { id: S2, name: "Сахар-Трейд", contact: "", phone: "", note: "" },
        ],
      }),
    },
    { bot_id: BOT, key: `supplier_of:${P1}`, value: S1 },
    { bot_id: BOT, key: `supplier_of:${P2}`, value: S1 },
    { bot_id: BOT, key: `supplier_of:${P3}`, value: S2 },
  ];
  db.tables.products = [
    prod(P1, "Мука", 3), // на пороге (5), продаж нет
    prod(P2, "Рис", 100), // много остатка, но продаётся быстро — прогноз
    prod(P3, "Сахар", 2), // порог
    prod(P4, "Соль", 4), // порог, без поставщика
  ];
  db.tables.orders = [
    { id: 1, bot_id: BOT, created_at: day(2), status: "delivered", fulfillment_kind: "physical" },
  ];
  db.tables.order_items = [{ id: "a", order_id: 1, product_id: P2, quantity: 300 }];
  const ctx = {
    tenant: { id: BOT, modules: { stock: true, warehouse: true }, settings: { served_by: "v2" } },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("предложение заявок", () => {
  it("предложенное количество: на 30 дней продаж или двойной порог, минус остаток, не меньше 1", () => {
    expect(suggestQty(3, 0, 5)).toBe(7); // 10 − 3
    expect(suggestQty(100, 300, 0)).toBe(200); // 300 − 100
    expect(suggestQty(50, 0, 5)).toBe(1);
  });

  it("состав по поставщикам; товары без поставщика — отдельной группой, последней", async () => {
    const { ctx } = setup();
    const groups = await suggestRequests(ctx, NOW);
    expect(groups.map((g) => g.supplierId)).toEqual([S1, S2, null]);
    const [flour, , salt] = groups;
    // у Мука-Опт: Рис (по прогнозу, хватит на 10 дн.? 300 за 30 дн. = 10/день, 100 → 10 дн. — не меньше недели),
    // поэтому в группе только Мука.
    expect(flour!.lines.map((l) => [l.productId, l.reason, l.qty])).toEqual([[P1, "low", 7]]);
    expect(salt!.lines.map((l) => l.productId)).toEqual([P4]);
  });

  it("прогноз меньше недели добавляет товар, а «и то и другое» помечается", () => {
    const groups = buildSuggestions({
      low: [{ id: P1, name: "Мука", stock: 3, threshold: 5 }],
      products: [
        { id: P1, name: "Мука", stock: 3 },
        { id: P2, name: "Рис", stock: 20 },
      ],
      sold: new Map([
        [P1, 30],
        [P2, 300],
      ]),
      supplierOf: new Map([[P1, S1]]),
      skip: new Set(),
    });
    const all = groups.flatMap((g) => g.lines);
    expect(all.find((l) => l.productId === P1)).toMatchObject({ reason: "both", qty: 27 });
    expect(all.find((l) => l.productId === P2)).toMatchObject({ reason: "forecast", days: 2 });
    expect(groups.at(-1)!.supplierId).toBeNull();
  });

  it("товар из открытой заявки в предложение не попадает", async () => {
    const { ctx } = setup();
    await createRequest(ctx, { supplierId: S1, lines: [{ productId: P1, qty: 7 }] }, "admin");
    const groups = await suggestRequests(ctx, NOW);
    expect(groups.flatMap((g) => g.lines.map((l) => l.productId))).not.toContain(P1);
  });
});

describe("жизнь заявки", () => {
  it("создать, править черновик, «заказано» один раз, удалить можно только черновик", async () => {
    const { ctx } = setup();
    const r = await createRequest(ctx, { supplierId: S1, lines: [{ productId: P1, qty: 7 }] }, "a");
    expect(r).toMatchObject({ no: 1, status: "draft" });
    const u = await updateRequest(ctx, r.id, {
      supplierId: S1,
      lines: [{ productId: P1, qty: 9 }],
    });
    expect(u.lines[0]!.qty).toBe(9);
    const o = await markOrdered(ctx, r.id, NOW);
    expect(o).toMatchObject({ status: "ordered", orderedAt: NOW.toISOString() });
    await expect(markOrdered(ctx, r.id)).rejects.toMatchObject({ key: "err.stock.requestState" });
    await expect(
      updateRequest(ctx, r.id, { supplierId: S1, lines: [{ productId: P1, qty: 1 }] }),
    ).rejects.toMatchObject({ key: "err.stock.requestState" });
    await expect(deleteRequest(ctx, r.id)).rejects.toMatchObject({ key: "err.stock.requestState" });
    expect((await loadRequest(ctx, r.id))!.status).toBe("ordered");
  });

  it("плохие количества, неизвестный товар и поставщик — отказ", async () => {
    const { ctx } = setup();
    await expect(createRequest(ctx, { supplierId: S1, lines: [] }, "a")).rejects.toMatchObject({
      key: "err.stock.requestEmpty",
    });
    await expect(
      createRequest(ctx, { supplierId: S1, lines: [{ productId: P1, qty: 0 }] }, "a"),
    ).rejects.toMatchObject({ key: "err.stock.badQty" });
    await expect(
      createRequest(
        ctx,
        {
          supplierId: null,
          lines: [{ productId: "77777777-7777-4777-8777-777777777777", qty: 1 }],
        },
        "a",
      ),
    ).rejects.toMatchObject({ key: "err.stock.receiptProduct" });
    await expect(
      createRequest(
        ctx,
        { supplierId: "88888888-8888-4888-8888-888888888888", lines: [{ productId: P1, qty: 1 }] },
        "a",
      ),
    ).rejects.toMatchObject({ key: "err.stock.supplierNotFound" });
  });

  it("номера идут подряд, список — свежие сверху", async () => {
    const { ctx } = setup();
    await createRequest(ctx, { supplierId: S1, lines: [{ productId: P1, qty: 1 }] }, "a");
    await createRequest(ctx, { supplierId: null, lines: [{ productId: P4, qty: 1 }] }, "a");
    expect((await listRequests(ctx)).map((r) => r.no)).toEqual([2, 1]);
  });
});

describe("приход по заявке закрывает её", () => {
  async function ordered() {
    const s = setup();
    const r = await createRequest(
      s.ctx,
      { supplierId: S1, lines: [{ productId: P1, qty: 7 }] },
      "a",
    );
    await markOrdered(s.ctx, r.id, NOW);
    return { ...s, r };
  }

  it("проведённый приход переводит заявку в «принято» и остаток прибавляется", async () => {
    const { ctx, db, r } = await ordered();
    const receipt = await receiptFromRequest(ctx, r.id, "admin");
    expect(receipt).toMatchObject({ requestId: r.id, supplierId: S1, status: "draft" });
    expect(receipt.lines).toMatchObject([{ productId: P1, qty: 7, price: 0 }]);
    expect((await loadRequest(ctx, r.id))!.status).toBe("ordered");
    await postReceipt(ctx, receipt.id, "admin", NOW);
    expect(db.tables.products!.find((p) => p.id === P1)!.stock_quantity).toBe(10);
    expect(await loadRequest(ctx, r.id)).toMatchObject({
      status: "received",
      receiptId: receipt.id,
      receivedAt: NOW.toISOString(),
    });
  });

  it("второй приход по той же заявке не создаётся, пока первый жив; после удаления — можно", async () => {
    const { ctx, r } = await ordered();
    const first = await receiptFromRequest(ctx, r.id, "admin");
    await expect(receiptFromRequest(ctx, r.id, "admin")).rejects.toMatchObject({
      key: "err.stock.requestHasReceipt",
    });
    const { deleteReceipt } = await import("./receipts");
    await deleteReceipt(ctx, first.id);
    expect(await loadReceipt(ctx, first.id)).toBeNull();
    const second = await receiptFromRequest(ctx, r.id, "admin");
    expect(second.id).not.toBe(first.id);
  });

  it("два клика одновременно — один черновик прихода", async () => {
    const { ctx, r } = await ordered();
    const res = await Promise.allSettled([
      receiptFromRequest(ctx, r.id, "a"),
      receiptFromRequest(ctx, r.id, "b"),
    ]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const { listReceipts } = await import("./receipts");
    expect((await listReceipts(ctx)).filter((x) => x.requestId === r.id)).toHaveLength(1);
  });

  it("приход по неотправленной (черновой) заявке не создаётся; повторное закрытие ничего не меняет", async () => {
    const { ctx } = setup();
    const r = await createRequest(ctx, { supplierId: S1, lines: [{ productId: P1, qty: 7 }] }, "a");
    await expect(receiptFromRequest(ctx, r.id, "a")).rejects.toMatchObject({
      key: "err.stock.requestNotOrdered",
    });
    await markOrdered(ctx, r.id, NOW);
    expect(
      await closeRequestByReceipt(ctx, r.id, "99999999-9999-4999-8999-999999999999", NOW),
    ).toBe(true);
    expect(
      await closeRequestByReceipt(ctx, r.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", NOW),
    ).toBe(false);
    expect((await loadRequest(ctx, r.id))!.receiptId).toBe("99999999-9999-4999-8999-999999999999");
  });
});

describe("текст и CSV", () => {
  const req = {
    id: S1,
    no: 3,
    supplierId: S1,
    lines: [
      { productId: P1, name: "Мука", qty: 7 },
      { productId: P2, name: "=Рис", qty: 200 },
    ],
    status: "draft" as const,
    createdAt: "",
    createdBy: "a",
    orderedAt: null,
    receivedAt: null,
    receiptId: null,
  };
  it("текст на языке продавца: контакт, позиции с количеством", () => {
    const ru = requestText(req, { name: "Мука-Опт", contact: "Айгуль" }, "ru");
    expect(ru).toContain("Здравствуйте, Айгуль!");
    expect(ru).toContain("• Мука — 7 шт.");
    expect(ru).toContain("• =Рис — 200 шт.");
    const en = requestText(req, null, "en");
    expect(en).toContain("Hello!");
    expect(en).toContain("• Мука — 7 pcs");
    expect(en).not.toMatch(/Здравствуйте|шт\./);
  });
  it("CSV: BOM, «;», защита от формул", () => {
    const csv = requestCsv(req, "ru");
    expect(csv.startsWith("﻿№;Товар;Количество\r\n")).toBe(true);
    expect(csv).toContain("1;Мука;7");
    expect(csv).toContain("2;'=Рис;200");
  });
});
