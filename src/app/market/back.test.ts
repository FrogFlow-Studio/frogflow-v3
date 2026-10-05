import { describe, expect, it } from "vitest";
import { readMarketBack, rememberMarketBack } from "./back";

const store = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};

describe("возврат с магазина на площадку (П2)", () => {
  it("запоминает фильтр и язык без смещения страницы, по адресу магазина", () => {
    const s = store();
    rememberMarketBack(
      "lavka",
      "/market/search",
      { q: "торт", category: "Торты", offset: 50, lang: "kk", x: "y" },
      s,
    );
    expect(readMarketBack("lavka", s)).toEqual({
      to: "/market/search",
      search: { lang: "kk", q: "торт", category: "Торты" },
    });
    expect(readMarketBack("drugoy", s)).toBeNull();
  });

  it("испорченная запись и чужой адрес возврата не пускаются", () => {
    const s = store();
    s.setItem("ff_market_back:a", "{не json");
    expect(readMarketBack("a", s)).toBeNull();
    s.setItem(
      "ff_market_back:b",
      JSON.stringify({ to: "https://evil.example/", search: { q: "x" } }),
    );
    expect(readMarketBack("b", s)).toBeNull();
  });

  it("хранилища нет или оно ломается — тихо, без ошибки", () => {
    expect(() => rememberMarketBack("a", "/market", {}, null)).not.toThrow();
    expect(readMarketBack("a", null)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => rememberMarketBack("a", "/market", { q: "x" }, broken)).not.toThrow();
    expect(readMarketBack("a", broken)).toBeNull();
  });
});
