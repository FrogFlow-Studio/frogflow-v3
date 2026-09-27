import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { PICKER_LIMIT, pickerTerm, productsByIds, searchProducts } from "./picker";
import { PRODUCT_PAGE, listProductsForAdmin } from "./admin";
import { UPSELL_KEY, upsellFor } from "@/core/upsell/upsell";

/**
 * Крупный каталог (у AATeach 459 товаров): формы админки и список товаров
 * не теряют товары за прежними потолками 200/500, а PostgREST отдаёт не
 * больше 1000 строк за запрос, как в Supabase.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function shop(count: number, patch: (n: number) => Record<string, unknown> = () => ({})) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: count }, (_, i) => ({
    id: id(i + 1),
    bot_id: BOT,
    name: `Прописи ${String(i + 1).padStart(4, "0")}`,
    price: 1000 + i,
    currency: "KZT",
    is_active: true,
    sort_order: 0,
    fulfillment_kind: "digital",
    stock_quantity: null,
    category_ids: [],
    rating_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    ...patch(i + 1),
  }));
  const ctx = { tenant: { id: BOT, modules: { upsell: true } }, db } as unknown as TenantContext;
  return { db, ctx };
}

describe("выбор товара поиском", () => {
  it("находит товар за прежним потолком в 200 и 500", async () => {
    const { ctx } = shop(700);
    expect((await searchProducts(ctx, { q: "0459" })).map((p) => p.id)).toEqual([id(459)]);
    expect((await searchProducts(ctx, { q: "0650" })).map((p) => p.id)).toEqual([id(650)]);
  });

  it("без запроса — первые по алфавиту, не больше лимита; скрытые и исключённые не предлагаются", async () => {
    const { ctx } = shop(100, (n) => (n === 2 ? { is_active: false } : {}));
    const r = await searchProducts(ctx, { exclude: [id(1)] });
    expect(r).toHaveLength(PICKER_LIMIT);
    expect(r[0]!.id).toBe(id(3));
    expect(r[0]).toEqual({ id: id(3), name: "Прописи 0003", price: 1002, currency: "KZT" });
  });

  it("подстановочные знаки и синтаксис фильтра в запросе — просто пробелы", () => {
    expect(pickerTerm(" 50%_скидка,(всё)* ")).toBe("50  скидка  всё");
  });

  it("названия выбранных находятся по id пачками, включая скрытые", async () => {
    const { ctx } = shop(700, (n) => (n === 690 ? { is_active: false } : {}));
    const ids = Array.from({ length: 250 }, (_, i) => id(450 + i));
    const r = await productsByIds(ctx, [...ids, ids[0]!]);
    expect(r.map((p) => p.id).sort()).toEqual([...ids].sort());
  });
});

describe("список товаров постранично", () => {
  it("459 товаров с одинаковой позицией и названием: каждый ровно один раз", async () => {
    // Одинаковые sort_order и названия — порядок держит только id в хвосте.
    const { ctx } = shop(459, () => ({ name: "Прописи" }));
    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const page = await listProductsForAdmin(ctx, { offset });
      expect(page.total).toBe(459);
      expect(page.rows.length).toBeLessThanOrEqual(PRODUCT_PAGE);
      seen.push(...page.rows.map((r) => r.id));
      offset += page.rows.length;
      if (!page.hasMore) break;
    }
    expect(seen).toHaveLength(459);
    expect(new Set(seen).size).toBe(459);
  });

  it("поиск и «только скрытые» считают и листают отфильтрованное", async () => {
    const { ctx } = shop(300, (n) => (n > 150 ? { is_active: false } : {}));
    const hidden = await listProductsForAdmin(ctx, { onlyInactive: true });
    expect(hidden).toMatchObject({ total: 150, hasMore: true });
    expect(hidden.rows).toHaveLength(PRODUCT_PAGE);
    const rest = await listProductsForAdmin(ctx, { onlyInactive: true, offset: PRODUCT_PAGE });
    expect(rest).toMatchObject({ total: 150, hasMore: false });
    expect(rest.rows).toHaveLength(50);
    const found = await listProductsForAdmin(ctx, { q: "0299" });
    expect(found.rows.map((r) => r.id)).toEqual([id(299)]);
  });
});

describe("«С этим берут» в крупном каталоге", () => {
  it("правило продавца срабатывает и для товара за первыми 500", async () => {
    // Популярные — первые 500; товар из правила и сам товар корзины — вне их.
    const { db, ctx } = shop(700, (n) => ({ rating_count: n <= 500 ? 1000 - n : 0 }));
    db.tables.app_settings = [
      { bot_id: BOT, key: UPSELL_KEY, value: JSON.stringify({ [id(690)]: [id(680)] }) },
    ];
    const r = await upsellFor(ctx, [id(690)]);
    expect(r[0]).toMatchObject({ id: id(680), name: "Прописи 0680" });
  });
});
