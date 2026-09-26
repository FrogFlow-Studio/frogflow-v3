import { describe, expect, it } from "vitest";
import { fromRules, parseRules } from "./upsell";

describe("апсейл — правила", () => {
  it("разбор игнорирует мусор", () => {
    expect(parseRules('{"a":["b",1,"c"],"x":"y"}')).toEqual({ a: ["b", "c"] });
    expect(parseRules("[1]")).toEqual({});
    expect(parseRules("{")).toEqual({});
  });
  it("кандидаты по порядку корзины, без дублей и без уже лежащего в корзине, с лимитом", () => {
    const rules = { a: ["b", "c", "d"], b: ["c", "e"] };
    expect(fromRules(["a"], rules)).toEqual(["b", "c", "d"]);
    expect(fromRules(["a", "b"], rules)).toEqual(["c", "d", "e"]);
    expect(fromRules(["a", "b"], rules, 2)).toEqual(["c", "d"]);
    expect(fromRules(["z"], rules)).toEqual([]);
  });
});
