import { describe, expect, it } from "vitest";
import type { StoreProduct } from "@/core/storefront/catalog";
import {
  LIST_TTL_MS,
  appendPage,
  listPosition,
  parseListContext,
  restorable,
  scrollTarget,
  swipeDirection,
  type ListContext,
} from "./list-context";

const NOW = 1_800_000_000_000;
const ctx = (over: Partial<ListContext> = {}): ListContext => ({
  v: 1,
  key: "k",
  at: NOW,
  listIndex: 3,
  ids: ["a", "b", "c"],
  extra: [],
  hasMore: false,
  current: "b",
  query: { slug: "demo", q: "сентябрь" },
  firstOffset: 0,
  ...over,
});
const product = (id: string) => ({ id }) as StoreProduct;

describe("сохранённый список", () => {
  it("читается обратно", () => {
    expect(parseListContext(JSON.stringify(ctx()), "demo", NOW + 1000)).toEqual(ctx());
  });
  it("битый, чужого магазина или старше 30 минут — не используется", () => {
    expect(parseListContext("{", "demo", NOW)).toBeNull();
    expect(parseListContext(null, "demo", NOW)).toBeNull();
    expect(parseListContext(JSON.stringify(ctx()), "other", NOW)).toBeNull();
    expect(parseListContext(JSON.stringify(ctx()), "demo", NOW + LIST_TTL_MS + 1)).toBeNull();
    expect(parseListContext(JSON.stringify({ ...ctx(), ids: [1] }), "demo", NOW)).toBeNull();
  });
});

describe("возврат в каталог", () => {
  it("тот же список на той же записи истории — восстанавливаем", () => {
    expect(restorable(ctx(), "k", 3)).not.toBeNull();
  });
  it("новый вход в каталог (другая запись) или другой поиск — начинаем сверху", () => {
    expect(restorable(ctx(), "k", 5)).toBeNull();
    expect(restorable(ctx(), "other", 3)).toBeNull();
  });
  it("прокрутка к открытому товару, а если его скрыли — к ближайшему соседу", () => {
    const ids = ["a", "b", "c", "d"];
    expect(scrollTarget(ids, "c", new Set(ids))).toBe("c");
    expect(scrollTarget(ids, "c", new Set(["a", "d"]))).toBe("d");
    expect(scrollTarget(ids, "c", new Set(["a"]))).toBe("a");
    expect(scrollTarget(ids, "c", new Set())).toBeNull();
    expect(scrollTarget(ids, null, new Set(ids))).toBeNull();
  });
});

describe("листание на карточке", () => {
  it("открыт из списка — соседи и номер", () => {
    expect(listPosition(ctx(), "b", 4)).toEqual({
      index: 1,
      total: 3,
      hasMore: false,
      prev: "a",
      next: "c",
    });
    expect(listPosition(ctx(), "a", 4)?.prev).toBeNull();
    expect(listPosition(ctx(), "c", 4)?.next).toBeNull();
  });
  it("прямая ссылка или товар не из списка — стрелок нет", () => {
    expect(listPosition(ctx(), "b", 7)).toBeNull();
    expect(listPosition(ctx(), "z", 4)).toBeNull();
    expect(listPosition(null, "b", 4)).toBeNull();
  });
  it("догруженная страница встаёт в конец без повторов", () => {
    const next = appendPage(ctx(), [product("c"), product("d")], true, NOW + 5);
    expect(next.ids).toEqual(["a", "b", "c", "d"]);
    expect(next.extra.map((p) => p.id)).toEqual(["d"]);
    expect(next.hasMore).toBe(true);
    expect(listPosition(next, "c", 4)?.next).toBe("d");
  });
  it("свайп: влево — следующий, вправо — предыдущий; вертикаль и короткий — нет", () => {
    expect(swipeDirection(-80, 10)).toBe("next");
    expect(swipeDirection(80, -10)).toBe("prev");
    expect(swipeDirection(-40, 0)).toBeNull();
    expect(swipeDirection(-80, 60)).toBeNull();
  });
});
