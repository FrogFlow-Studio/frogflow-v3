import { describe, expect, it } from "vitest";
import { fuzzyIds, withinOneEdit } from "./fuzzy";
import { searchProductsTolerant } from "./catalog";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

describe("withinOneEdit", () => {
  it("замена, пропуск, вставка и перестановка — одна правка", () => {
    expect(withinOneEdit("прописи", "прописи")).toBe(true);
    expect(withinOneEdit("прописи", "преписи")).toBe(true);
    expect(withinOneEdit("прописи", "прописи")).toBe(true);
    expect(withinOneEdit("прописи", "проописи")).toBe(true);
    expect(withinOneEdit("прописи", "пропсии")).toBe(true);
  });
  it("две правки — уже нет", () => {
    expect(withinOneEdit("прописи", "преписа")).toBe(false);
    expect(withinOneEdit("прописи", "проп")).toBe(false);
  });
});

describe("fuzzyIds", () => {
  const items = [
    { id: "a", text: "Прописи для дошкольников дидактика" },
    { id: "b", text: "Футболка белая хлопок" },
  ];
  it("опечатка в одну букву находит", () => {
    expect(fuzzyIds("прэписи", items)).toEqual(["a"]);
    expect(fuzzyIds("футболка бемая", items)).toEqual(["b"]);
  });
  it("короткое слово с опечаткой — нет (иначе ловится мусор)", () => {
    expect(fuzzyIds("лес", [{ id: "c", text: "Лис" }])).toEqual([]);
  });
  it("слов, которых нет нигде, — пусто; пустой запрос — пусто", () => {
    expect(fuzzyIds("ботинки", items)).toEqual([]);
    expect(fuzzyIds("  ", items)).toEqual([]);
  });
  it("точное совпадение идёт раньше совпадения с опечаткой", () => {
    const r = fuzzyIds("футболка", [
      { id: "z", text: "футбалка" },
      { id: "y", text: "футболка" },
    ]);
    expect(r).toEqual(["y", "z"]);
  });
});

describe("searchProductsTolerant", () => {
  const ctx = (rows: Record<string, unknown>[]) => {
    const db = fakeDb();
    db.tables.products = rows;
    db.tables.product_variants = [];
    return { db, tenant: { id: "t" }, appUrl: "https://a.test" } as unknown as TenantContext;
  };
  const row = (id: string, name: string, active = true) => ({
    id,
    name,
    keywords: null,
    description: null,
    is_active: active,
    sort_order: 0,
  });

  it("точное совпадение работает как раньше", async () => {
    const c = ctx([row("1", "Прописи"), row("2", "Футболка")]);
    expect((await searchProductsTolerant(c, "прописи")).map((p) => p.id)).toEqual(["1"]);
  });
  it("опечатка в одну букву находит товар; скрытый товар не находит", async () => {
    const c = ctx([row("1", "Прописи"), row("2", "Прописи скрытые", false)]);
    expect((await searchProductsTolerant(c, "прэписи")).map((p) => p.id)).toEqual(["1"]);
  });
  it("ничего похожего — пусто", async () => {
    const c = ctx([row("1", "Прописи")]);
    expect(await searchProductsTolerant(c, "ботинки")).toEqual([]);
  });
});
