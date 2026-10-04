import { describe, expect, it } from "vitest";
import { RECENT_MAX, orderRecent, parseRecent, pushRecent } from "./recent";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("недавно смотрели", () => {
  it("битая строка и чужие значения не ломают список", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{")).toEqual([]);
    expect(parseRecent(JSON.stringify([id(1), "x", 5, id(1), id(2)]))).toEqual([id(1), id(2)]);
  });
  it("открытый товар встаёт первым и не дублируется", () => {
    expect(pushRecent([id(1), id(2)], id(2))).toEqual([id(2), id(1)]);
    expect(pushRecent([id(1)], "")).toEqual([id(1)]);
  });
  it("список ограничен, старые уходят", () => {
    let l: string[] = [];
    for (let i = 1; i <= RECENT_MAX + 3; i++) l = pushRecent(l, id(i));
    expect(l).toHaveLength(RECENT_MAX);
    expect(l[0]).toBe(id(RECENT_MAX + 3));
  });
  it("порядок как смотрели; исчезнувшие и текущий товар не показываются", () => {
    const products = [{ id: id(1) }, { id: id(3) }];
    expect(orderRecent([id(3), id(2), id(1)], products)).toEqual([{ id: id(3) }, { id: id(1) }]);
    expect(orderRecent([id(3), id(1)], products, new Set([id(3)]))).toEqual([{ id: id(1) }]);
  });
});
