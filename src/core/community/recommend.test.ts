import { describe, expect, it } from "vitest";
import type { TenantSettings } from "@/core/tenant/types";
import { RECOMMEND_MAX, cleanRecommend, mutualRecommendations } from "./recommend";

const shop = (id: string, rec: string[] = [], extra: Partial<TenantSettings> = {}) => ({
  id,
  settings: {
    served_by: "v2",
    community: { enabled: true, name: `Автор ${id}` },
    community_recommend: rec,
    ...extra,
  } as TenantSettings,
});

describe("взаимные рекомендации", () => {
  it("видна только взаимная: один рекомендует — другой молчит, значит не показываем", () => {
    const a = shop("a", ["b"]);
    const b = shop("b", []);
    expect(mutualRecommendations(a, [a, b])).toEqual([]);
    expect(mutualRecommendations(b, [a, b])).toEqual([]);
  });

  it("взаимная видна обоим", () => {
    const a = shop("a", ["b"]);
    const b = shop("b", ["a"]);
    expect(mutualRecommendations(a, [a, b]).map((t) => t.id)).toEqual(["b"]);
    expect(mutualRecommendations(b, [a, b]).map((t) => t.id)).toEqual(["a"]);
  });

  it("отозвал согласие — рекомендация исчезает у обоих сама", () => {
    const b = shop("b", ["a"]);
    const aOn = shop("a", ["b"]);
    expect(mutualRecommendations(b, [aOn, b])).toHaveLength(1);
    // «a» убрал «b» из списка
    expect(mutualRecommendations(b, [shop("a", []), b])).toEqual([]);
    // «a» выключил сообщество
    const aOff = shop("a", ["b"], { community: { enabled: false, name: "Автор a" } });
    expect(mutualRecommendations(b, [aOff, b])).toEqual([]);
    expect(mutualRecommendations(aOff, [aOff, b])).toEqual([]);
  });

  it("скрытый оператором или со старой платформы не рекомендуется и не рекомендует", () => {
    const b = shop("b", ["a"]);
    const hidden = shop("a", ["b"], { community_mod: { status: "hidden" } });
    const old = shop("a", ["b"], { served_by: undefined });
    expect(mutualRecommendations(b, [hidden, b])).toEqual([]);
    expect(mutualRecommendations(b, [old, b])).toEqual([]);
    expect(mutualRecommendations(hidden, [hidden, b])).toEqual([]);
  });

  it("список чистится: не строки, повторы, сам себя, не больше пяти", () => {
    expect(cleanRecommend(["x", "x", "me", 5, "y"], "me")).toEqual(["x", "y"]);
    expect(cleanRecommend("x", "me")).toEqual([]);
    const many = ["1", "2", "3", "4", "5", "6", "7"];
    expect(cleanRecommend(many, "me")).toHaveLength(RECOMMEND_MAX);
  });
});
