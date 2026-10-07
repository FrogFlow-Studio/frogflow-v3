import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { CATALOG_KEY } from "./pricelist/catalog.server";
import { decidePricelistReply, loadPricelistData } from "./pricelist/engine.server";
import { searchPricelist, searchPricelistPage, searchStoryProducts } from "./story-picker";
import { listStoryTags, upsertStoryTag } from "./story-tags";

/**
 * Жалоба BOVI 29.09: в списке товаров для публикации Instagram нет новинок
 * (новых корзин для белья), и он не совпадает с прайсом в базе знаний.
 */
const item = (id: string, name: string, category = "Blomus", price = 48000) => ({
  id,
  name,
  category,
  size: "",
  colors: [],
  price_kzt: price,
  stock: true,
});

// 900 строк прайса: новинки — в конце выгрузки, после урны KORIE.
const PRICELIST = [
  ...Array.from({ length: 897 }, (_, i) =>
    item(`old-${i}`, `BOVI Наволочки ${String(i).padStart(3, "0")}`, "Бельё", 25000),
  ),
  item("00-001", "Blomus Урна для мусора KORIE, цвет белый (Корзина для белья)", "Blomus", 90000),
  item("00-777", "Blomus Корзина для белья FRISCO 60 л, серая", "Blomus", 74000),
  item("00-778", "Blomus Корзина для белья LAUNDRY 50 л, бежевая", "Blomus", 69000),
];

const PRODUCTS = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Корзина из каталога сайта", price: 1000 },
];

function shop(pricelist: boolean) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: "bovi", key: CATALOG_KEY, value: JSON.stringify(PRICELIST) }];
  db.tables.products = PRODUCTS.map((p) => ({
    ...p,
    bot_id: "bovi",
    currency: "KZT",
    is_active: true,
  }));
  return {
    db,
    ctx: {
      tenant: {
        id: "bovi",
        modules: { instagram: true },
        settings: pricelist ? { consultant_pricelist: { enabled: true } } : {},
      },
      db,
      timezone: "Asia/Almaty",
      appUrl: "https://app.test",
    } as unknown as TenantContext,
  };
}

describe("товары для публикации Instagram", () => {
  it("консультант по прайсу: новинки из конца выгрузки находятся, каталог сайта не подмешивается", async () => {
    const { ctx } = shop(true);
    const r = await searchStoryProducts(ctx, "корзина для белья");
    expect(r.source).toBe("pricelist");
    expect(r.items.map((p) => p.id)).toEqual(["00-777", "00-778", "00-001"]);
    expect(r.items[0]).toEqual({
      id: "00-777",
      name: "Blomus Корзина для белья FRISCO 60 л, серая",
      price: 74000,
    });
  });

  it("пустой запрос — первые по алфавиту, слова ищутся в любом порядке и регистре", () => {
    expect(searchPricelist(PRICELIST, "")).toHaveLength(30);
    expect(searchPricelist(PRICELIST, "frisco КОРЗИНА").map((p) => p.id)).toEqual(["00-777"]);
  });

  it("прайс листается дальше первых 30: всего найдено и следующая страница без повторов", async () => {
    const first = searchPricelistPage(PRICELIST, "");
    expect(first.items).toHaveLength(30);
    expect(first.total).toBe(PRICELIST.length);
    const next = searchPricelistPage(PRICELIST, "", 30);
    expect(next.items.length).toBe(Math.min(30, PRICELIST.length - 30));
    const ids = [...first.items, ...next.items].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const { ctx } = shop(true);
    const r = await searchStoryProducts(ctx, "", 30);
    expect(r.total).toBe(PRICELIST.length);
    expect(r.items.map((p) => p.id)).toEqual(next.items.map((p) => p.id));
  });

  it("без прайса — поиск по каталогу магазина", async () => {
    const { ctx } = shop(false);
    const r = await searchStoryProducts(ctx, "корзина");
    expect(r).toEqual({
      source: "catalog",
      items: [{ id: PRODUCTS[0]!.id, name: "Корзина из каталога сайта", price: 1000 }],
    });
  });

  it("сбой чтения прайса — ошибка, а не «ничего не найдено»", async () => {
    const { ctx, db } = shop(true);
    const from = db.from.bind(db);
    const down = { data: null, error: { message: "connection reset" } };
    db.from = ((table: string) =>
      table === "app_settings"
        ? { select: () => ({ in: async () => down }) }
        : from(table)) as typeof db.from;
    await expect(searchStoryProducts(ctx, "корзина")).rejects.toThrow(/connection reset/);
  });

  it("тег с несколькими товарами прайса: консультант видит их в ответе на публикацию", async () => {
    const { ctx } = shop(true);
    await upsertStoryTag(ctx, {
      story: "https://www.instagram.com/p/DPbovi777/",
      products: [
        { id: "00-777", name: "Blomus Корзина для белья FRISCO 60 л, серая", price: 74000 },
        { id: "00-778", name: "Blomus Корзина для белья LAUNDRY 50 л, бежевая", price: 69000 },
      ],
    });
    const [tag] = await listStoryTags(ctx);
    expect(tag).toMatchObject({ story_id: "DPbovi777", product_id: "00-777", price: 74000 });
    expect(tag!.products).toHaveLength(2);

    const sent: string[] = [];
    const data = await loadPricelistData(ctx, Date.parse("2026-10-06T06:00:00Z"));
    await decidePricelistReply(data, {
      text: "сколько стоит?",
      state: {},
      now: new Date("2026-10-06T06:00:00Z"),
      story: { storyId: null, mediaUrl: "https://www.instagram.com/p/DPbovi777/" },
      fetchImage: async () => null,
      call: async (req) => {
        sent.push(JSON.stringify(req.messages));
        return {
          content: [{ type: "text", text: "FRISCO — 74 000 ₸, LAUNDRY — 69 000 ₸." }],
          stop_reason: "end_turn",
        } as unknown as Anthropic.Message;
      },
    });
    expect(sent[0]).toContain("Товары в ней");
    expect(sent[0]).toContain("FRISCO 60 л");
    expect(sent[0]).toContain("LAUNDRY 50 л");
  });

  it("тег без товара не сохраняется", async () => {
    const { ctx } = shop(true);
    await expect(upsertStoryTag(ctx, { story: "DPbovi777", products: [] })).rejects.toThrow(
      /товар/,
    );
  });
});
