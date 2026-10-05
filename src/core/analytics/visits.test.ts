import { describe, expect, it } from "vitest";
import { SOURCE_ROWS, type SourceRow } from "./source-funnel";
import { attachVisits, foldVisits, visitSource } from "./visits";

const OWN = "www.frogflow.tech";

describe("источник визита (У1)", () => {
  it("метка из ссылки — та же группа, что у воронки по источникам", () => {
    expect(visitSource({ webSource: "site:vesna", referrer: null })).toBe("tag:vesna");
    expect(visitSource({ webSource: "site:ref-anna", referrer: null })).toBe("referral");
    expect(visitSource({ webSource: "site:google/spring", referrer: null })).toBe(
      "site:google/spring",
    );
  });

  it("без метки: поиск, площадка, другой сайт, прямой заход", () => {
    const r = (referrer: string | null) => visitSource({ webSource: null, referrer, ownHost: OWN });
    expect(r("https://www.google.com/")).toBe("search");
    expect(r("https://yandex.kz/search/?text=x")).toBe("search");
    expect(r("https://www.frogflow.tech/market/search?q=x")).toBe("market");
    expect(r("https://www.frogflow.tech/s/shop")).toBe("direct");
    expect(r("https://blog.example.com/post")).toBe("link");
    expect(r("")).toBe("direct");
    expect(r(null)).toBe("direct");
    expect(r("не адрес")).toBe("direct");
    expect(r("android-app://com.google.android.gm")).toBe("direct");
  });

  it("метка сильнее реферера", () => {
    expect(
      visitSource({ webSource: "site:vesna", referrer: "https://www.google.com/", ownHost: OWN }),
    ).toBe("tag:vesna");
  });
});

describe("счётчик в отчёт (У1)", () => {
  it("итоги и по источникам; чужой этап и неположительные числа пропускаются", () => {
    const v = foldVisits([
      { day: "2026-10-01", source: "direct", stage: "visit", n: 10 },
      { day: "2026-10-02", source: "direct", stage: "visit", n: 5 },
      { day: "2026-10-01", source: "direct", stage: "product", n: 4 },
      { day: "2026-10-01", source: "search", stage: "visit", n: 3 },
      { day: "2026-10-01", source: "search", stage: "other", n: 99 },
      { day: "2026-10-01", source: "search", stage: "visit", n: -7 },
    ]);
    expect(v.total).toEqual({ visit: 18, product: 4 });
    expect(v.bySource).toEqual({
      direct: { visit: 15, product: 4 },
      search: { visit: 3, product: 0 },
    });
  });

  const row = (source: string, ordered = 0): SourceRow => ({
    source,
    arrived: 0,
    cart: 0,
    ordered,
    paid: 0,
    revenue: {},
  });

  it("визиты ложатся в свои строки, итог — в «все», источник без покупателей получает свою строку", () => {
    const v = foldVisits([
      { day: "d", source: "direct", stage: "visit", n: 10 },
      { day: "d", source: "tag:vesna", stage: "visit", n: 6 },
      { day: "d", source: "search", stage: "visit", n: 2 },
      { day: "d", source: "search", stage: "product", n: 1 },
    ]);
    const rows = attachVisits([row("all"), row("direct", 3), row("tag:vesna", 1)], v);
    expect(rows.map((r) => [r.source, r.visit, r.product])).toEqual([
      ["all", 18, 1],
      ["direct", 10, 0],
      ["tag:vesna", 6, 0],
      ["search", 2, 1],
    ]);
    expect(rows.slice(1).reduce((s, r) => s + (r.visit ?? 0), 0)).toBe(rows[0]!.visit);
  });

  it("мест в таблице нет — лишние источники сворачиваются в «другие», сумма сходится", () => {
    const named = Array.from({ length: SOURCE_ROWS - 1 }, (_, i) => row(`tag:t${i}`, 5));
    const v = foldVisits([
      ...named.map((r) => ({ day: "d", source: r.source, stage: "visit", n: 1 })),
      { day: "d", source: "search", stage: "visit", n: 7 },
      { day: "d", source: "link", stage: "visit", n: 3 },
    ]);
    const rows = attachVisits([row("all"), ...named], v);
    // одно место осталось: его берёт источник с большим числом визитов, второй уходит в «другие»
    expect(rows.find((r) => r.source === "search")!.visit).toBe(7);
    expect(rows.find((r) => r.source === "link")).toBeUndefined();
    expect(rows.at(-1)).toMatchObject({ source: "other", visit: 3 });
    expect(rows.slice(1).reduce((s, r) => s + (r.visit ?? 0), 0)).toBe(rows[0]!.visit);
  });

  it("строка «другие» уже есть — остаётся одной и последней", () => {
    const v = foldVisits([{ day: "d", source: "search", stage: "visit", n: 4 }]);
    const rows = attachVisits([row("all"), row("direct", 1), row("other", 1)], v);
    expect(rows.filter((r) => r.source === "other")).toHaveLength(1);
    expect(rows.find((r) => r.source === "search")!.visit).toBe(4);
  });
});
