import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storeCatalog, storeInfo } from "./catalog";
import { categoryChips } from "./categories";

type Row = Record<string, unknown>;

/**
 * Таблица products с тем подмножеством фильтров PostgREST, которым пользуется
 * витрина: eq, contains по jsonb-массиву и or из ilike-шаблонов. ilike с
 * `%…%` — подстрока без учёта регистра, как в Postgres.
 */
function productsDb(rows: Row[], categories: Row[] = []) {
  const calls: { or: string[] } = { or: [] };
  const db = {
    from(table: string) {
      if (table === "app_settings") {
        const q = { select: () => q, in: async () => ({ data: [], error: null }) };
        return q;
      }
      if (table === "categories") {
        const q = {
          select: () => q,
          order: () => q,
          then: (ok: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: categories, error: null }).then(ok),
        };
        return q;
      }
      if (table === "product_variants") {
        // Варианты берутся из вложенных product_variants строк товаров.
        const all = rows.flatMap((r) =>
          ((r.product_variants as Row[]) ?? []).map((v): Row => ({ ...v, product_id: r.id })),
        );
        let hit = all;
        const q = {
          select: () => q,
          limit: () => q,
          ilike(col: string, pat: string) {
            const needle = pat.replace(/^%|%$/g, "").toLowerCase();
            hit = hit.filter((v) =>
              String(v[col] ?? "")
                .toLowerCase()
                .includes(needle),
            );
            return q;
          },
          then: (ok: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: hit, error: null }).then(ok),
        };
        return q;
      }
      if (table !== "products") throw new Error(`неожиданная таблица: ${table}`);
      const filters: Array<(r: Row) => boolean> = [];
      let one = false;
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v);
          return q;
        },
        contains(col: string, json: string) {
          const need = JSON.parse(json) as unknown[];
          filters.push((r) => need.every((x) => ((r[col] as unknown[]) ?? []).includes(x)));
          return q;
        },
        or(expr: string) {
          calls.or.push(expr);
          const parts = expr.split(/,(?![^(]*\))/).map((p) => {
            const [col, op, ...rest] = p.split(".");
            if (op === "in") {
              const list = rest
                .join(".")
                .replace(/^\(|\)$/g, "")
                .split(",");
              return (r: Row) => list.includes(String(r[col!]));
            }
            if (op !== "ilike") throw new Error(`неожиданный оператор: ${op}`);
            const needle = rest.join(".").replace(/^%|%$/g, "").toLowerCase();
            return (r: Row) =>
              String(r[col!] ?? "")
                .toLowerCase()
                .includes(needle);
          });
          filters.push((r) => parts.some((f) => f(r)));
          return q;
        },
        maybeSingle() {
          one = true;
          return q;
        },
        then(ok: (v: { data: unknown; error: null }) => unknown) {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          return Promise.resolve({ data: one ? (hit[0] ?? null) : hit, error: null }).then(ok);
        },
      };
      return q;
    },
  };
  return { db, calls };
}

function product(id: string, over: Row = {}): Row {
  return {
    id,
    name: `Товар ${id}`,
    description: null,
    keywords: null,
    price: 500,
    currency: "KZT",
    is_active: true,
    category_ids: [],
    fulfillment_kind: "digital",
    stock_quantity: null,
    lead_time_days: null,
    rating_avg: null,
    rating_count: 0,
    product_images: [],
    product_variants: [],
    product_material_files: [{ language: "ru", file_path: `bot/${id}.pdf`, file_name: "a.pdf" }],
    ...over,
  };
}

function ctxWith(rows: Row[], modules: Record<string, boolean> = {}, categories: Row[] = []) {
  const { db, calls } = productsDb(rows, categories);
  const ctx = {
    tenant: { id: "bot-1", modules, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, calls };
}

const ids = (list: Array<{ id: string }>) => list.map((p) => p.id);

describe("storeCatalog: поиск витрины", () => {
  const catalog = [
    product("grade4", { name: "Математика. Тесты", keywords: "4 класс, дроби, сложение" }),
    product("grade5", {
      name: "Математика 5 класс",
      description: "24 задания на уравнения",
      keywords: "5 класс, уравнения",
    }),
    product("cake", {
      name: "Red cake",
      description: "Chocolate dessert",
      keywords: "birthday",
    }),
  ];

  it("ищет запрос одной фразой, как бот, а не пересечением слов", async () => {
    const { ctx, calls } = ctxWith(catalog);
    expect(ids(await storeCatalog(ctx, { q: "4 класс" }))).toEqual(["grade4"]);
    expect(ids(await storeCatalog(ctx, { q: "5 класс" }))).toEqual(["grade5"]);
    expect(ids(await storeCatalog(ctx, { q: "математика 5 класс" }))).toEqual(["grade5"]);
    // Один шаблон на фразу по трём колонкам — без разбиения на слова.
    expect(calls.or[2]).toBe(
      "name.ilike.%математика 5 класс%,keywords.ilike.%математика 5 класс%,description.ilike.%математика 5 класс%",
    );
  });

  it("ищет по названию, описанию и ключевым словам без учёта регистра", async () => {
    const { ctx } = ctxWith(catalog);
    expect(ids(await storeCatalog(ctx, { q: "RED CAKE" }))).toEqual(["cake"]);
    expect(ids(await storeCatalog(ctx, { q: "chocolate" }))).toEqual(["cake"]);
    expect(ids(await storeCatalog(ctx, { q: "birthday" }))).toEqual(["cake"]);
  });

  it("находит товар по названию варианта (v1: «large» находит вариант)", async () => {
    const { ctx } = ctxWith([
      ...catalog,
      product("shirt", {
        name: "Футболка",
        product_variants: [
          { id: "v-s", name: "Маленькая", price: 500, sort_order: 0 },
          { id: "v-l", name: "Большая", price: 700, sort_order: 1 },
        ],
      }),
    ]);
    expect(ids(await storeCatalog(ctx, { q: "БОЛЬШ" }))).toEqual(["shirt"]);
    // Совпадения по тексту товара и по варианту — вместе, без дублей.
    expect(ids(await storeCatalog(ctx, { q: "а" })).sort()).toEqual(
      ["grade4", "grade5", "shirt"].sort(),
    );
    expect(ids(await storeCatalog(ctx, { q: "средняя" }))).toEqual([]);
  });
});

describe("storeCatalog: фильтр категории", () => {
  it("товар без категории — только в общем каталоге, не в выбранной категории", async () => {
    const { ctx } = ctxWith(
      [product("in-cakes", { category_ids: ["cakes"] }), product("uncategorized")],
      {},
      [{ id: "cakes", name: "Торты", parent_id: null, is_visible: true }],
    );
    expect(ids(await storeCatalog(ctx, { categoryId: "cakes" }))).toEqual(["in-cakes"]);
    expect(ids(await storeCatalog(ctx))).toEqual(["in-cakes", "uncategorized"]);
    expect(ids(await storeCatalog(ctx, { categoryId: null }))).toEqual([
      "in-cakes",
      "uncategorized",
    ]);
  });
});

describe("storeCatalog: скрытые категории и подкатегории, как в v1", () => {
  const cat = (id: string, parent: string | null = null, visible = true): Row => ({
    id,
    name: id,
    parent_id: parent,
    is_visible: visible,
    sort_order: 0,
  });
  // cakes ⟶ tiers ⟶ wedding; hidden ⟶ hidden-child (видна сама, но родитель скрыт)
  const categories = [
    cat("cakes"),
    cat("tiers", "cakes"),
    cat("wedding", "tiers"),
    cat("hidden", null, false),
    cat("hidden-child", "hidden"),
  ];
  const products = [
    product("top", { category_ids: ["cakes"] }),
    product("sub", { category_ids: ["tiers"] }),
    product("deep", { category_ids: ["wedding"] }),
    product("secret", { category_ids: ["hidden"] }),
    product("secret-child", { category_ids: ["hidden-child"] }),
    product("both", { category_ids: ["hidden", "cakes"] }),
    product("free"),
  ];

  it("убирает товары, у которых все категории скрыты — в том числе через скрытого родителя", async () => {
    const { ctx } = ctxWith(products, {}, categories);
    expect(ids(await storeCatalog(ctx))).toEqual(["top", "sub", "deep", "both", "free"]);
    // Поиск идёт по тому же каталогу.
    expect(ids(await storeCatalog(ctx, { q: "secret" }))).toEqual([]);
  });

  it("родительская категория включает товары всех своих подкатегорий", async () => {
    const { ctx } = ctxWith(products, {}, categories);
    expect(ids(await storeCatalog(ctx, { categoryId: "cakes" }))).toEqual([
      "top",
      "sub",
      "deep",
      "both",
    ]);
    expect(ids(await storeCatalog(ctx, { categoryId: "tiers" }))).toEqual(["sub", "deep"]);
    expect(ids(await storeCatalog(ctx, { categoryId: "hidden" }))).toEqual([]);
  });

  it("витрина не показывает скрытые категории и подкатегории скрытых", async () => {
    const { ctx } = ctxWith([], {}, categories);
    const info = await storeInfo(ctx);
    expect(info.categories.map((c) => c.id)).toEqual(["cakes", "tiers", "wedding"]);
  });

  it("подкатегория скрытого родителя не всплывает на витрине главной категорией", async () => {
    const { ctx } = ctxWith([], {}, categories);
    const { roots, subs } = categoryChips((await storeInfo(ctx)).categories);
    // hidden-child видна сама, но её родитель скрыт: в дерево она не попадает вовсе.
    expect(roots.map((c) => c.id)).toEqual(["cakes"]);
    expect(categoryChips((await storeInfo(ctx)).categories, "hidden-child").current).toBeNull();
    expect(subs).toEqual([]);
  });
});

describe("storeCatalog: значки языков материалов", () => {
  const multi = product("multi", {
    product_material_files: [
      { language: "ru", file_path: "bot/ru.pdf", file_name: "ru.pdf" },
      { language: "kk", file_path: "bot/kk.pdf", file_name: "kk.pdf" },
      { language: null, file_path: "bot/old.pdf", file_name: "old.pdf" },
    ],
  });

  it("без модуля «Мультиязычность» значков нет: покупатель получит только русский", async () => {
    const { ctx } = ctxWith([multi]);
    expect((await storeCatalog(ctx))[0]!.languages).toEqual([]);
  });

  it("с модулем — все языки товара, без повторов", async () => {
    const { ctx } = ctxWith([multi], { multi_language: true });
    expect((await storeCatalog(ctx))[0]!.languages).toEqual(["ru", "kk"]);
  });
});

describe("storeCatalog: сортировка, как в Mini App v1", () => {
  it("сортирует после поиска и фильтров; без сортировки — порядок продавца", async () => {
    const { ctx } = ctxWith([
      product("a", { price: 900, created_at: "2026-01-01T00:00:00Z", rating_count: 1 }),
      product("b", { price: 300, created_at: "2026-03-01T00:00:00Z", rating_count: 40 }),
      product("c", { price: 500, created_at: "2026-02-01T00:00:00Z", rating_count: 0 }),
    ]);
    expect(ids(await storeCatalog(ctx))).toEqual(["a", "b", "c"]);
    expect(ids(await storeCatalog(ctx, { sort: "price" }))).toEqual(["b", "c", "a"]);
    expect(ids(await storeCatalog(ctx, { sort: "new" }))).toEqual(["b", "c", "a"]);
    expect(ids(await storeCatalog(ctx, { sort: "popular" }))).toEqual(["b", "a", "c"]);
  });
});

describe("storeCatalog: срок изготовления", () => {
  it("shows lead time on physical products and hides it for digital", async () => {
    const { ctx } = ctxWith([
      product("cake", { fulfillment_kind: "physical", lead_time_days: 3 }),
      product("pdf", { fulfillment_kind: "digital", lead_time_days: 3 }),
    ]);
    const list = await storeCatalog(ctx);
    expect(list.find((p) => p.id === "cake")!.leadTimeDays).toBe(3);
    expect(list.find((p) => p.id === "pdf")!.leadTimeDays).toBeNull();
  });
});
