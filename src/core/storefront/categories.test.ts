import { describe, expect, it } from "vitest";
import {
  categoryChips,
  categorySubtree,
  parseCatalogLayout,
  visibleCategoryIds,
} from "./categories";

// Как в тесте v1 (tests/category-tree.test.ts): математика ⟶ 5 класс, физика, скрытая.
const cats = [
  { id: "math", name: "Математика", parent_id: null, is_visible: true },
  { id: "grade5", name: "5 класс", parent_id: "math", is_visible: true },
  { id: "physics", name: "Физика", parent_id: null, is_visible: true },
  { id: "hidden", name: "Скрыто", parent_id: null, is_visible: false },
];
const visible = visibleCategoryIds(cats);
const shown = cats.filter((c) => visible.has(c.id));
const ids = (xs: Array<{ id: string }>) => xs.map((c) => c.id);

describe("дерево категорий витрины, как в v1", () => {
  it("по умолчанию — только корневые папки, как в боте", () => {
    const r = categoryChips(shown);
    expect(ids(r.roots)).toEqual(["math", "physics"]);
    expect(r.current).toBeNull();
    expect(r.subs).toEqual([]);
  });

  it("открытая главная категория показывает детей, а товары детей входят в неё", () => {
    const r = categoryChips(shown, "math");
    expect(r.current?.id).toBe("math");
    expect(r.path).toEqual(["math"]);
    expect(r.subParent).toBe("math");
    expect(ids(r.subs)).toEqual(["grade5"]);
    expect([...categorySubtree(cats, "math", visible)].sort()).toEqual(["grade5", "math"]);
  });

  it("у открытого листа второй ряд — соседи, корень подсвечен", () => {
    const r = categoryChips(shown, "grade5");
    expect(r.path).toEqual(["math", "grade5"]);
    expect(r.subParent).toBe("math");
    expect(ids(r.subs)).toEqual(["grade5"]);
    expect(ids(r.roots)).toEqual(["math", "physics"]);
  });

  it("лист без родителя — второго ряда нет; неизвестный id — как без выбора", () => {
    expect(categoryChips(shown, "physics").subs).toEqual([]);
    const r = categoryChips(shown, "hidden");
    expect(r.current).toBeNull();
    expect(r.subs).toEqual([]);
  });

  it("подкатегория удалённого родителя встаёт в корень, цикл не зависает", () => {
    const orphan = [
      ...shown,
      { id: "algebra", name: "Алгебра", parent_id: "deleted", is_visible: true },
    ];
    expect(ids(categoryChips(orphan).roots)).toEqual(["math", "physics", "algebra"]);
    const loop = [
      { id: "a", parent_id: "b" },
      { id: "b", parent_id: "a" },
    ];
    expect(categoryChips(loop, "a").path).toEqual(["b", "a"]);
  });
});

describe("раскладка категорий Mini App (mini_app_catalog), как в v1", () => {
  it("настройка v1 читается как есть; пустая или битая — дерево", () => {
    expect(parseCatalogLayout(null)).toEqual({ layout: "tree", order: [] });
    expect(parseCatalogLayout("не json")).toEqual({ layout: "tree", order: [] });
    expect(parseCatalogLayout('{"layout":"grid"}')).toEqual({ layout: "tree", order: [] });
    expect(parseCatalogLayout('{"layout":"flat","order":[]}')).toEqual({
      layout: "flat",
      order: [],
    });
    const many = Array.from({ length: 90 }, (_, i) => `c${i}`);
    const r = parseCatalogLayout(JSON.stringify({ layout: "custom", order: [...many, 5, ""] }));
    expect(r.layout).toBe("custom");
    expect(r.order).toEqual(many.slice(0, 80));
  });

  it("свой порядок верхнего ряда: подкатегорию можно поднять наверх", () => {
    const layout = { layout: "custom" as const, order: ["grade5", "hidden", "gone", "physics"] };
    const r = categoryChips(shown, null, layout);
    // Скрытая и удалённая пропущены; порядок — продавца.
    expect(ids(r.roots)).toEqual(["grade5", "physics"]);
    // Открытая поднятая подкатегория подсвечена сама, а не её родитель.
    expect(categoryChips(shown, "grade5", layout).active).toBe("grade5");
    expect(categoryChips(shown, "grade5").active).toBe("math");
    // Пустой свой порядок — обычное дерево.
    expect(ids(categoryChips(shown, null, { layout: "custom", order: [] }).roots)).toEqual([
      "math",
      "physics",
    ]);
  });

  it("плоский список — все категории деревом в одном ряду, второго ряда нет", () => {
    const layout = { layout: "flat" as const, order: [] };
    expect(ids(categoryChips(shown, null, layout).roots)).toEqual(["math", "grade5", "physics"]);
    const open = categoryChips(shown, "math", layout);
    expect(open.subs).toEqual([]);
    expect(open.subParent).toBeNull();
    expect(open.active).toBe("math");
  });
});
