import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { JOURNAL_CSV_COLUMNS, journalCsv, listJournal, parseJournalFilter } from "./journal";

const BOT = "00000000-0000-0000-0000-000000000001";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const S1 = "55555555-5555-4555-8555-555555555555";

function ev(i: number, type: string, productId: string, payload: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    bot_id: BOT,
    event_id: `stock:${i}`,
    event_type: `stock.${type}`,
    status: "event",
    // Пять событий в одну секунду — порядок страниц держит только id.
    created_at: `2026-10-0${1 + (i % 3)}T10:00:00.000Z`,
    payload: { product_id: productId, from: 10, to: 9, actor: "system", ...payload },
  };
}

function setup(n = 7) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "suppliers",
      value: JSON.stringify({
        rev: 1,
        items: [{ id: S1, name: "Опт", contact: "", phone: "", note: "" }],
      }),
    },
  ];
  db.tables.products = [
    { id: P1, bot_id: BOT, name: "Торт" },
    { id: P2, bot_id: BOT, name: "Книга" },
  ];
  db.tables.orders = [{ id: 7, bot_id: BOT, order_no: 7, display_no: 70 }];
  const rows = [
    ev(1, "order", P1, { order_id: 7 }),
    ev(2, "receipt", P1, { from: 9, to: 14, receipt_no: 3, supplier_id: S1, actor: "admin:ann" }),
    ev(3, "writeoff", P2, { from: 5, to: 4, writeoff_reason: "defect", comment: "треснул" }),
    ev(4, "stocktake", P2, { from: 4, to: 6 }),
    ev(5, "edit", P1),
    { ...ev(6, "unknown_reason", P1) },
    { ...ev(7, "order", P2), event_type: "message.received" },
  ];
  db.tables.zernio_logs = rows.slice(0, n);
  const ctx = {
    tenant: { id: BOT, modules: {} },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("журнал склада", () => {
  it("показывает только движения остатка с названием, номером заказа, приходом и поставщиком", async () => {
    const { ctx } = setup();
    const { entries, total } = await listJournal(ctx, {});
    // Чужое событие и неизвестная причина в журнал не попадают.
    expect(entries.map((e) => e.reason).sort()).toEqual([
      "edit",
      "order",
      "receipt",
      "stocktake",
      "writeoff",
    ]);
    expect(total).toBe(6); // посчитано базой по префиксу stock.; неизвестную причину код отбрасывает
    const r = entries.find((e) => e.reason === "receipt")!;
    expect(r).toMatchObject({
      name: "Торт",
      receiptNo: 3,
      supplierName: "Опт",
      from: 9,
      to: 14,
      actor: "admin:ann",
    });
    expect(entries.find((e) => e.reason === "order")).toMatchObject({ orderNo: 70 });
    expect(entries.find((e) => e.reason === "writeoff")).toMatchObject({ note: "треснул" });
  });

  it("фильтры: товар, причина, поставщик, даты", async () => {
    const { ctx } = setup();
    expect((await listJournal(ctx, { productId: P2 })).entries.map((e) => e.reason).sort()).toEqual(
      ["stocktake", "writeoff"],
    );
    expect((await listJournal(ctx, { reason: "receipt" })).entries).toHaveLength(1);
    expect((await listJournal(ctx, { supplierId: S1 })).entries.map((e) => e.reason)).toEqual([
      "receipt",
    ]);
    // 2026-10-02 по Алматы: событие №2 (i % 3 = 2 → 10-03) и №5 (→ 10-03) не входят, №1,4 → 10-02.
    const day = await listJournal(ctx, { from: "2026-10-02", to: "2026-10-02" });
    expect(day.entries.every((e) => e.at.startsWith("2026-10-02"))).toBe(true);
    expect(day.entries.length).toBeGreaterThan(0);
  });

  it("постранично без обрезки и повторов, сортировка кончается id", async () => {
    const { ctx, db } = setup(5);
    for (let i = 100; i < 230; i++) db.tables.zernio_logs!.push(ev(i, "edit", P1));
    const pages = [];
    for (let p = 0; p < 4; p++) pages.push(await listJournal(ctx, {}, { page: p, pageSize: 50 }));
    const all = pages.flatMap((p) => p.entries);
    expect(pages[0]!.total).toBe(135);
    expect(all).toHaveLength(135);
    expect(new Set(all.map((e) => e.id)).size).toBe(135);
    // Внутри одной секунды — по убыванию id.
    const sameSecond = all.filter((e) => e.at === all[0]!.at).map((e) => e.id);
    expect(sameSecond).toEqual([...sameSecond].sort().reverse());
  });

  it("CSV: заголовок, BOM, строки по фильтру, все страницы", async () => {
    const { ctx, db } = setup(5);
    for (let i = 100; i < 1250; i++) db.tables.zernio_logs!.push(ev(i, "edit", P1));
    const all = await journalCsv(ctx, {});
    expect(all.count).toBe(1155);
    expect(all.csv.charCodeAt(0)).toBe(0xfeff);
    expect(all.csv.split("\r\n")[0]).toBe(JOURNAL_CSV_COLUMNS.join(";").replace(/^/, "﻿"));
    const one = await journalCsv(ctx, { reason: "receipt" });
    expect(one.count).toBe(1);
    expect(one.csv).toContain("Торт;Приход;9;14;5;;3;Опт;;admin:ann");
  });

  it("CSV защищён от формул в комментарии", async () => {
    const { ctx, db } = setup(3);
    db.tables.zernio_logs!.find((r) => r.event_type === "stock.writeoff")!.payload = {
      product_id: P2,
      from: 5,
      to: 4,
      comment: "=HYPERLINK(1)",
    };
    expect((await journalCsv(ctx, { reason: "writeoff" })).csv).toContain("'=HYPERLINK(1)");
  });

  it("фильтр из запроса: неверное отбрасывается", () => {
    expect(
      parseJournalFilter({ reason: "xx", productId: "bad", from: "2026-13", to: "2026-10-05" }),
    ).toEqual({
      productId: null,
      supplierId: null,
      reason: null,
      from: null,
      to: "2026-10-05",
    });
    expect(parseJournalFilter({ reason: "writeoff", supplierId: S1 })).toMatchObject({
      reason: "writeoff",
      supplierId: S1,
    });
  });
});
