import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { COURSE_MARKER_URL } from "@/core/courses/marker";
import {
  PRODUCT_PAGE,
  listProductIdsForAdmin,
  listProductsForAdmin,
  matchesLangFilter,
} from "./admin";

/**
 * Список товаров админки (пожелания Кристины Дидактика): «сначала новые»,
 * фильтр «есть / нет на казахском» и поиск по ключевым словам.
 */
const BOT = "00000000-0000-0000-0000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => `2026-09-${String(1 + (n % 28)).padStart(2, "0")}T10:00:00Z`;

function shop(count: number, patch: (n: number) => Record<string, unknown> = () => ({})) {
  const db = fakeDb({ maxRows: 1000 });
  db.tables.products = Array.from({ length: count }, (_, i) => ({
    id: id(i + 1),
    bot_id: BOT,
    name: `Прописи ${String(i + 1).padStart(4, "0")}`,
    keywords: "",
    price: 1000 + i,
    currency: "KZT",
    is_active: true,
    sort_order: 0,
    fulfillment_kind: "digital",
    stock_quantity: null,
    category_ids: [],
    created_at: "2026-09-01T00:00:00Z",
    ...patch(i + 1),
  }));
  db.tables.product_material_files = [];
  const ctx = { tenant: { id: BOT, modules: {} }, db } as unknown as TenantContext;
  return { db, ctx };
}

async function walk(ctx: TenantContext, opts: Parameters<typeof listProductsForAdmin>[1]) {
  const seen: string[] = [];
  let offset = 0;
  for (;;) {
    const page = await listProductsForAdmin(ctx, { ...opts, offset });
    seen.push(...page.rows.map((r) => r.id));
    offset += page.rows.length;
    if (!page.hasMore) return { seen, total: page.total };
  }
}

describe("порядок списка товаров", () => {
  it("«сначала новые»: последний добавленный первым, у одинаковой даты — по id, без повторов между страницами", async () => {
    const { ctx } = shop(250, (n) => ({ created_at: n > 240 ? "2026-10-07T09:00:00Z" : day(n) }));
    const first = await listProductsForAdmin(ctx, { sort: "new" });
    expect(first.rows.slice(0, 10).map((r) => r.id)).toEqual(
      [250, 249, 248, 247, 246, 245, 244, 243, 242, 241].map(id),
    );
    const { seen } = await walk(ctx, { sort: "new" });
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });

  it("«сначала старые», «по названию», «по цене» и по умолчанию — как в каталоге", async () => {
    const { ctx } = shop(4, (n) => ({
      name: ["Б", "А", "Г", "В"][n - 1],
      price: [300, 100, 200, 400][n - 1],
      sort_order: [2, 1, 4, 3][n - 1],
      created_at: day(5 - n),
    }));
    const names = async (sort?: "old" | "name" | "price" | "catalog") =>
      (await listProductsForAdmin(ctx, { sort })).rows.map((r) => r.name);
    expect(await names("old")).toEqual(["В", "Г", "А", "Б"]);
    expect(await names("name")).toEqual(["А", "Б", "В", "Г"]);
    expect(await names("price")).toEqual(["А", "Г", "Б", "В"]);
    expect(await names()).toEqual(["А", "Б", "В", "Г"]);
    expect(await names("catalog")).toEqual(await names());
  });
});

describe("поиск в списке товаров", () => {
  it("находит по ключевым словам, а не только по названию (код материала)", async () => {
    const { ctx } = shop(5, (n) => (n === 3 ? { keywords: "КД-0457, буквы" } : {}));
    const found = await listProductsForAdmin(ctx, { q: "кд-0457" });
    expect(found.rows.map((r) => r.id)).toEqual([id(3)]);
    expect(found.total).toBe(1);
    expect(await listProductIdsForAdmin(ctx, { q: "кд-0457" })).toEqual([id(3)]);
  });
});

describe("фильтр «Язык материалов»", () => {
  // 1 — файл kk в новой таблице, 2 — казахский файл v1 в file_path_kz, 3 — только ru,
  // 4 — без файлов, 5 — физический, 6 — курс.
  function catalog() {
    const s = shop(6, (n) =>
      n === 2
        ? { file_path_kz: "bot/old-kz.pdf", file_path: "bot/old-ru.pdf" }
        : n === 5
          ? { fulfillment_kind: "physical" }
          : n === 6
            ? { file_url: COURSE_MARKER_URL }
            : {},
    );
    s.db.tables.product_material_files = [
      { id: "f1", product_id: id(1), language: "kk", file_path: "bot/1-kk.pdf", sort_order: 0 },
      { id: "f2", product_id: id(1), language: "ru", file_path: "bot/1-ru.pdf", sort_order: 0 },
      { id: "f3", product_id: id(3), language: "ru", file_path: "bot/3-ru.pdf", sort_order: 0 },
    ];
    return s;
  }

  it("«есть на KZ» учитывает старое поле v1, «нет на KZ» — только цифровые без файла, без физических и курсов", async () => {
    const { ctx } = catalog();
    const has = await listProductsForAdmin(ctx, { lang: { lang: "kk", has: true } });
    expect(has.rows.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(has.total).toBe(2);
    const missing = await listProductsForAdmin(ctx, { lang: { lang: "kk", has: false } });
    expect(missing.rows.map((r) => r.id)).toEqual([id(3), id(4)]);
    expect(missing).toMatchObject({ total: 2, hasMore: false });
    expect(await listProductIdsForAdmin(ctx, { lang: { lang: "kk", has: false } })).toEqual([
      id(3),
      id(4),
    ]);
  });

  it("языки каждой строки видны в списке", async () => {
    const { ctx } = catalog();
    const rows = (await listProductsForAdmin(ctx)).rows;
    const langs = Object.fromEntries(rows.map((r) => [r.id, r.langs]));
    expect(langs[id(1)]).toEqual(["ru", "kk"]);
    expect(langs[id(2)]).toEqual(["ru", "kk"]);
    expect(langs[id(3)]).toEqual(["ru"]);
    expect(langs[id(4)]).toEqual([]);
  });

  it("фильтр языка с «сначала новые» листает весь каталог страницами без потерь", async () => {
    const { ctx, db } = shop(1450, (n) => ({ created_at: day(n) }));
    db.tables.product_material_files = Array.from({ length: 1450 }, (_, i) => ({
      id: `f${i}`,
      product_id: id(i + 1),
      language: (i + 1) % 3 === 0 ? "kk" : "ru",
      file_path: `bot/${i}.pdf`,
      sort_order: 0,
    }));
    const { seen, total } = await walk(ctx, { sort: "new", lang: { lang: "kk", has: false } });
    expect(total).toBe(1450 - 483);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen.every((x) => Number(x.slice(-12)) % 3 !== 0)).toBe(true);
    const page = await listProductsForAdmin(ctx, { sort: "new", lang: { lang: "kk", has: false } });
    expect(page.rows).toHaveLength(PRODUCT_PAGE);
    const created = page.rows.map((r) => r.created_at);
    expect(created).toEqual([...created].sort().reverse());
  });

  it("сбой чтения — ошибка, а не пустой список «нет на KZ»", async () => {
    const { ctx, db } = catalog();
    const broken = { ...ctx, db: withBrokenReads(db, ["products"]) } as TenantContext;
    await expect(
      listProductsForAdmin(broken, { lang: { lang: "kk", has: false } }),
    ).rejects.toThrow();
    await expect(
      listProductIdsForAdmin(broken, { lang: { lang: "kk", has: false } }),
    ).rejects.toThrow();
  });

  it("matchesLangFilter: товар без файлов вообще — «нет на RU», физический — никогда", () => {
    expect(matchesLangFilter({ fulfillment_kind: "digital" }, { lang: "ru", has: false })).toBe(
      true,
    );
    expect(matchesLangFilter({ fulfillment_kind: "physical" }, { lang: "ru", has: false })).toBe(
      false,
    );
    expect(matchesLangFilter({ file_url_kz: "https://x" }, { lang: "kk", has: true })).toBe(true);
  });
});
