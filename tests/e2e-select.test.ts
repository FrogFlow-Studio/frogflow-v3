import { describe, expect, it } from "vitest";
import {
  SMOKE,
  isLayout,
  routePattern,
  routeSegments,
  select,
  type Project,
} from "../scripts/e2e-select.ts";

function project(sources: Record<string, string>, specs: Record<string, string>): Project {
  const all = { ...sources };
  return {
    sources: new Map(Object.entries(sources)),
    specs: new Map(Object.entries(specs)),
    read: (f) => all[f] ?? "",
    exists: (f) => f in all,
  };
}

describe("адрес маршрута из имени файла", () => {
  it("убирает _authed, index и хвостовое подчёркивание, разбирает [.]", () => {
    expect(routeSegments("src/routes/admin._authed.settings.tsx")).toEqual(["admin", "settings"]);
    expect(routeSegments("src/routes/admin._authed.customers_.$key.tsx")).toEqual([
      "admin",
      "customers",
      "$key",
    ]);
    expect(routeSegments("src/routes/s.$slug.index.tsx")).toEqual(["s", "$slug"]);
    expect(routeSegments("src/routes/robots[.]txt.ts")).toEqual(["robots.txt"]);
    expect(routeSegments("src/routes/api/health.ts")).toEqual(["api", "health"]);
  });

  it("находит адрес целиком и хвостом после подставленного префикса", () => {
    const checkout = routePattern("src/routes/s.$slug.checkout.tsx");
    expect(checkout.test("page.goto(`/s/${F.SHOP_SLUG}/checkout`)")).toBe(true);
    expect(checkout.test("page.goto(`${shop}/checkout`)")).toBe(true);
    expect(checkout.test("toHaveURL(new RegExp(`/s/${S.slug}/checkout$`))")).toBe(true);
    expect(checkout.test("page.goto(`${shop}/checkout-old`)")).toBe(false);
    const orders = routePattern("src/routes/admin._authed.orders.tsx");
    expect(orders.test('page.goto("/admin/orders")')).toBe(true);
    expect(orders.test('page.goto("/admin/orders/new")')).toBe(false);
  });

  it("раскладка — файл, у которого есть дочерние маршруты", () => {
    const layout = "src/routes/admin._authed.tsx";
    const child = "src/routes/admin._authed.chat.tsx";
    expect(isLayout(layout, [layout, child])).toBe(true);
    expect(isLayout(child, [layout, child])).toBe(false);
  });
});

describe("какие e2e гонять", () => {
  const sources = {
    "src/routes/admin._authed.tsx": "",
    "src/routes/admin._authed.chat.tsx": 'import { Chat } from "@/app/admin/chat";',
    "src/routes/admin._authed.orders.tsx": "",
    "src/app/admin/chat.tsx": 'import { send } from "./chat.functions";',
    "src/app/admin/chat.functions.ts": "",
    "src/core/inbox/page.ts": "",
  };
  const specs = {
    "tests/e2e/chat.spec.ts": 'await page.goto("/admin/chat");',
    "tests/e2e/orders.spec.ts": 'await page.goto("/admin/orders");',
    "tests/e2e/other.spec.ts": "F.MARKET_SHOPS",
    "tests/e2e/a.spec.ts": "",
    "tests/e2e/b.spec.ts": "",
    "tests/e2e/c.spec.ts": "",
    "tests/e2e/d.spec.ts": "",
    ...Object.fromEntries(SMOKE.map((s) => [s, ""])),
  };
  const p = project(
    { ...sources, "tests/e2e/fixtures/market.ts": "export const MARKET_SHOPS = {};" },
    specs,
  );

  it("код страницы — specs её адреса и дымовой набор, по цепочке импортов", () => {
    const s = select(["src/app/admin/chat.functions.ts"], p);
    expect(s.mode).toBe("some");
    if (s.mode === "some") expect(s.specs).toEqual([...SMOKE, "tests/e2e/chat.spec.ts"].sort());
  });

  it("раскладка и общие файлы — все e2e", () => {
    expect(select(["src/routes/admin._authed.tsx"], p).mode).toBe("all");
    expect(select(["package.json"], p).mode).toBe("all");
    expect(select(["tests/e2e/helpers.ts"], p).mode).toBe("all");
  });

  it("изменённый spec и фикстура раздела — specs, которые её берут", () => {
    const s = select(["tests/e2e/orders.spec.ts", "tests/e2e/fixtures/market.ts"], p);
    expect(s.mode === "some" && s.specs).toEqual([
      "tests/e2e/orders.spec.ts",
      "tests/e2e/other.spec.ts",
    ]);
  });

  it("документы и unit-тесты — e2e не нужны", () => {
    expect(select(["docs/ROADMAP.md", "src/core/inbox/page.test.ts"], p).mode).toBe("none");
  });
});
