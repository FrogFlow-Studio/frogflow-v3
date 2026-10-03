import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import {
  claimLowStock,
  loadThresholds,
  lowStockProductKey,
  lowStockSentKey,
  lowStockText,
  parseThreshold,
  resetLowStock,
  saveProductThreshold,
  saveShopThreshold,
  LOW_STOCK_DEFAULT_KEY,
} from "./low-stock";

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const Q = "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff";

function setup(opts: { v2?: boolean; stock?: boolean } = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [
    { id: P, name: "Торт «Рафаэлло»", stock_quantity: 10 },
    { id: Q, name: "Безлимит", stock_quantity: null },
  ];
  db.tables.app_settings = [{ bot_id: T, key: LOW_STOCK_DEFAULT_KEY, value: "3" }];
  const ctx = {
    tenant: {
      id: T,
      modules: { stock: opts.stock ?? true },
      settings: opts.v2 === false ? {} : { served_by: "v2" },
    },
    db,
  } as unknown as TenantContext;
  const setStock = (id: string, n: number | null) => {
    db.tables.products!.find((p) => p.id === id)!.stock_quantity = n;
  };
  const marks = () =>
    db.tables.app_settings!.filter((r) => String(r.key).startsWith("low_stock_sent:")).length;
  return { ctx, db, setStock, marks };
}

describe("порог остатка", () => {
  it("разбор настройки: целое 0…100000, иное — не задан", () => {
    expect(parseThreshold("5")).toBe(5);
    expect(parseThreshold("0")).toBe(0);
    expect(parseThreshold("")).toBeNull();
    expect(parseThreshold(null)).toBeNull();
    expect(parseThreshold("2.5")).toBeNull();
    expect(parseThreshold("-1")).toBeNull();
    expect(parseThreshold("abc")).toBeNull();
    expect(parseThreshold("100001")).toBeNull();
  });

  it("выше порога — тихо; упал до порога — один раз, с остатком и порогом", async () => {
    const { ctx, setStock, marks } = setup();
    expect(await claimLowStock(ctx, [P])).toEqual([]);
    setStock(P, 3);
    expect(await claimLowStock(ctx, [P])).toEqual([
      { id: P, name: "Торт «Рафаэлло»", stock: 3, threshold: 3 },
    ]);
    expect(marks()).toBe(1);
    setStock(P, 2);
    expect(await claimLowStock(ctx, [P])).toEqual([]);
  });

  it("гонка: две оплаты подряд одновременно — одно сообщение", async () => {
    const { ctx, setStock, marks } = setup();
    setStock(P, 2);
    const [a, b, c] = await Promise.all([
      claimLowStock(ctx, [P]),
      claimLowStock(ctx, [P]),
      claimLowStock(ctx, [P, P]),
    ]);
    expect(a.length + b.length + c.length).toBe(1);
    expect(marks()).toBe(1);
  });

  it("пополнение выше порога и новое падение — снова одно сообщение", async () => {
    const { ctx, setStock, marks } = setup();
    setStock(P, 1);
    expect(await claimLowStock(ctx, [P])).toHaveLength(1);
    // продавец пополнил остаток в карточке: отметка снимается сразу
    setStock(P, 20);
    await resetLowStock(ctx, P);
    expect(marks()).toBe(0);
    setStock(P, 3);
    expect(await claimLowStock(ctx, [P])).toHaveLength(1);
    // пополнение без вызова сброса — отметку снимет ближайшая проверка выше порога
    setStock(P, 50);
    expect(await claimLowStock(ctx, [P])).toEqual([]);
    expect(marks()).toBe(0);
  });

  it("пополнение, не дотянувшее до порога, отметку не снимает", async () => {
    const { ctx, setStock, marks } = setup();
    setStock(P, 1);
    await claimLowStock(ctx, [P]);
    setStock(P, 3);
    await resetLowStock(ctx, P);
    expect(marks()).toBe(1);
    expect(await claimLowStock(ctx, [P])).toEqual([]);
  });

  it("порог товара перекрывает магазинный; 0 — не предупреждать; без остатка — тихо", async () => {
    const { ctx, db, setStock } = setup();
    db.tables.app_settings!.push({ bot_id: T, key: lowStockProductKey(P), value: "8" });
    setStock(P, 7);
    expect(await claimLowStock(ctx, [P])).toHaveLength(1);
    db.tables.app_settings = db.tables.app_settings!.filter((r) => r.key !== lowStockSentKey(P));
    db.tables.app_settings!.find((r) => r.key === lowStockProductKey(P))!.value = "0";
    setStock(P, 0);
    expect(await claimLowStock(ctx, [P])).toEqual([]);
    expect(await claimLowStock(ctx, [Q])).toEqual([]);
  });

  it("порога у магазина нет — никого не предупреждаем", async () => {
    const { ctx, db, setStock } = setup();
    db.tables.app_settings = [];
    setStock(P, 0);
    expect(await claimLowStock(ctx, [P])).toEqual([]);
  });

  it("клиент v1 и магазин без модуля «Склад» — ничего", async () => {
    const v1 = setup({ v2: false });
    v1.setStock(P, 0);
    expect(await claimLowStock(v1.ctx, [P])).toEqual([]);
    expect(v1.marks()).toBe(0);
    const off = setup({ stock: false });
    off.setStock(P, 0);
    expect(await claimLowStock(off.ctx, [P])).toEqual([]);
  });

  it("настройки магазина и товара пишутся и читаются; снятие порога товара", async () => {
    const { ctx } = setup();
    await saveShopThreshold(ctx, 5);
    await saveProductThreshold(ctx, P, 9);
    expect(await loadThresholds(ctx, P)).toEqual({ shop: 5, own: 9 });
    await saveProductThreshold(ctx, P, null);
    expect(await loadThresholds(ctx, P)).toEqual({ shop: 5, own: null });
    expect(await loadThresholds(ctx, null)).toEqual({ shop: 5, own: null });
  });

  it("текст на четырёх языках с остатком и порогом", () => {
    const item = { id: P, name: "X", stock: 2, threshold: 3 };
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const text = lowStockText(l, item, "X");
      expect(text).toContain("<b>X</b>");
      expect(text).toContain("2");
      expect(text).toContain("3");
    }
  });
});

const sent: Array<{ html: string; kind?: string }> = [];
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: async (_c: unknown, html: string, o: { kind?: string }) => {
    sent.push({ html, kind: o.kind });
    return 1;
  },
}));

describe("сообщение продавцу из уведомления о заказе", () => {
  it("два заказа подряд по одному товару — одно сообщение, название экранировано", async () => {
    const { notifyLowStock } = await import("@/channels/telegram/low-stock-notify");
    const { ctx, db, setStock } = setup();
    db.tables.products![0]!.name = "Торт <b>&";
    setStock(P, 2);
    const order = { order_items: [{ product_id: P }, { product_id: null }] };
    expect(await notifyLowStock(ctx, order)).toBe(1);
    expect(await notifyLowStock(ctx, order)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.kind).toBe("low_stock");
    expect(sent[0]!.html).toContain("Торт &lt;b&gt;&amp;");
  });

  it("сбой чтения не срывает уведомление о заказе", async () => {
    const { notifyLowStock } = await import("@/channels/telegram/low-stock-notify");
    const { ctx } = setup();
    (ctx as unknown as { db: unknown }).db = {
      from: () => {
        throw new Error("база недоступна");
      },
    };
    expect(await notifyLowStock(ctx, { order_items: [{ product_id: P }] })).toBe(0);
  });
});
