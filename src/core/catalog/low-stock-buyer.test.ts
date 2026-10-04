import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { COPY } from "@/channels/telegram/copy";
import { preorderKey } from "@/core/preorder/preorder";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import {
  buyerLowStock,
  loadShowToBuyer,
  LOW_STOCK_DEFAULT_KEY,
  LOW_STOCK_SHOW_KEY,
  lowStockLeft,
  lowStockProductKey,
  saveShowToBuyer,
} from "./low-stock";

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const product = (stock: number | null, kind = "physical") => ({
  id: P,
  stock_quantity: stock,
  fulfillment_kind: kind,
});

function setup(settings: Record<string, string> = {}, opts: { v2?: boolean } = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: T,
    key,
    value,
  }));
  const ctx = {
    tenant: {
      id: T,
      modules: { stock: true },
      settings: opts.v2 === false ? {} : { served_by: "v2" },
    },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const on = { [LOW_STOCK_SHOW_KEY]: "1", [LOW_STOCK_DEFAULT_KEY]: "5" };

describe("«осталось мало» покупателю", () => {
  it("по умолчанию выключено: остаток не раскрывается", async () => {
    const { ctx } = setup({ [LOW_STOCK_DEFAULT_KEY]: "5" });
    expect(await buyerLowStock(ctx, product(2))).toBeNull();
    expect(await loadShowToBuyer(ctx)).toBe(false);
  });

  it("включено, остаток не больше порога магазина — показываем точное число", async () => {
    const { ctx } = setup(on);
    expect(await buyerLowStock(ctx, product(2))).toBe(2);
    expect(await buyerLowStock(ctx, product(5))).toBe(5);
    expect(await buyerLowStock(ctx, product(6))).toBeNull();
  });

  it("порог товара перекрывает магазинный, 0 — не показывать", async () => {
    const own = setup({ ...on, [lowStockProductKey(P)]: "10" });
    expect(await buyerLowStock(own.ctx, product(8))).toBe(8);
    const zero = setup({ ...on, [lowStockProductKey(P)]: "0" });
    expect(await buyerLowStock(zero.ctx, product(1))).toBeNull();
    const noThreshold = setup({ [LOW_STOCK_SHOW_KEY]: "1" });
    expect(await buyerLowStock(noThreshold.ctx, product(1))).toBeNull();
  });

  it("нулевой остаток, товар без учёта остатка и цифровой — не «осталось»", async () => {
    const { ctx } = setup(on);
    expect(await buyerLowStock(ctx, product(0))).toBeNull();
    expect(await buyerLowStock(ctx, product(null))).toBeNull();
    expect(await buyerLowStock(ctx, product(2, "digital"))).toBeNull();
  });

  it("у товара с предзаказом не показываем", async () => {
    expect(await buyerLowStock(setup(on).ctx, product(2))).toBe(2);
    const { ctx } = setup({ ...on, [preorderKey(P)]: "2026-12-01" });
    expect(await buyerLowStock(ctx, product(2))).toBeNull();
  });

  it("клиент не на v2 не получает надпись", async () => {
    const { ctx } = setup(on, { v2: false });
    expect(await buyerLowStock(ctx, product(2))).toBeNull();
  });

  it("сбой чтения настроек убирает надпись, но не ломает карточку", async () => {
    const { db, ctx } = setup(on);
    const broken = {
      ...ctx,
      db: withBrokenReads(db, ["app_settings"]),
    } as unknown as TenantContext;
    await expect(buyerLowStock(broken, product(2))).resolves.toBeNull();
  });

  it("выключатель сохраняется и читается", async () => {
    const { ctx } = setup();
    await saveShowToBuyer(ctx, true);
    expect(await loadShowToBuyer(ctx)).toBe(true);
    await saveShowToBuyer(ctx, false);
    expect(await loadShowToBuyer(ctx)).toBe(false);
  });

  it("правило в чистом виде и тексты на 4 языках с числом", () => {
    expect(
      lowStockLeft({ stock: 3, threshold: 5, show: true, physical: true, preorder: true }),
    ).toBeNull();
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(COPY[l].lowStockLabel(7)).toContain("7");
    expect(
      new Set(["ru", "kk", "en", "uz"].map((l) => COPY[l as "ru"].lowStockLabel(7))).size,
    ).toBe(4);
  });
});
