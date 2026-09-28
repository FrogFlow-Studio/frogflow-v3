import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  apiOrder,
  createApiKey,
  loadApiKeyMeta,
  orderListQuery,
  revokeApiKey,
  secretMatches,
  splitApiToken,
} from "./public-api";

const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";

function shop() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  return {
    db,
    ctx: {
      tenant: { id: BOT, modules: { public_api: true }, settings: {} },
      db,
    } as unknown as TenantContext,
  };
}

describe("публичный API: ключ", () => {
  it("ключ показывается один раз, в базе — только отпечаток; новый отменяет прежний", async () => {
    const { ctx, db } = shop();
    const a = await createApiKey(ctx);
    expect(a.token.startsWith(`ffk_${BOT}_`)).toBe(true);
    const stored = JSON.stringify(db.tables.app_settings);
    const secretA = splitApiToken(a.token)!.secret;
    expect(stored).not.toContain(secretA);
    expect(secretMatches(secretA, await loadApiKeyMeta(ctx))).toBe(true);
    const b = await createApiKey(ctx);
    expect(secretMatches(secretA, await loadApiKeyMeta(ctx))).toBe(false);
    expect(secretMatches(splitApiToken(b.token)!.secret, await loadApiKeyMeta(ctx))).toBe(true);
    await revokeApiKey(ctx);
    expect(await loadApiKeyMeta(ctx)).toBeNull();
    expect(secretMatches(splitApiToken(b.token)!.secret, null)).toBe(false);
  });

  it("чужой формат ключа не разбирается", () => {
    expect(splitApiToken(null)).toBeNull();
    expect(splitApiToken("sk_live_123")).toBeNull();
    expect(splitApiToken(`ffk_${BOT}_short`)).toBeNull();
    expect(splitApiToken(`ffk_not-a-uuid_${"x".repeat(43)}`)).toBeNull();
    expect(splitApiToken(`ffk_${BOT}_${"x".repeat(43)}`)).toEqual({
      botId: BOT,
      secret: "x".repeat(43),
    });
  });
});

describe("публичный API: данные", () => {
  it("заказ — без чека, хешей и внутренней заметки", () => {
    const o = apiOrder({
      id: 5,
      display_no: 12,
      order_no: 12,
      status: "delivered",
      total: 1000,
      currency: "KZT",
      admin_note: "секрет",
      payment_proof_path: "b/order-5/1.jpg",
      payment_proof_hash: "abc",
      order_items: [
        {
          product_id: "p",
          product_variant_id: null,
          name_snapshot: "Методичка",
          quantity: 2,
          price_snapshot: 500,
        },
      ],
    } as never);
    expect(o).toMatchObject({ id: 5, number: 12, total: 1000, currency: "KZT" });
    expect(o.items).toEqual([
      { product_id: "p", variant_id: null, name: "Методичка", quantity: 2, price: 500 },
    ]);
    const text = JSON.stringify(o);
    expect(text).not.toContain("секрет");
    expect(text).not.toContain("order-5");
    expect(text).not.toContain("abc");
  });

  it("параметры списка: статус, дата, размер страницы, курсор", () => {
    const q = (s: string) => orderListQuery(new URL(`https://x/api/v1/orders${s}`));
    expect(q("")).toEqual({ status: null, since: null, limit: 50, before: null });
    expect(q("?status=paid&updated_since=2026-09-01&limit=100&before_id=40")).toEqual({
      status: "paid",
      since: "2026-09-01T00:00:00.000Z",
      limit: 100,
      before: 40,
    });
    expect(q("?limit=101")).toBeNull();
    expect(q("?updated_since=вчера")).toBeNull();
    expect(q("?status=paid;drop")).toBeNull();
    expect(q("?before_id=-1")).toBeNull();
  });
});
