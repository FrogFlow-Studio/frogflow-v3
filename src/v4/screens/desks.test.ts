import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deskOf, DESKS, type Desk } from "./desks";

describe("восемь рабочих мест", () => {
  const files = [
    ...readdirSync("src/routes").filter((f) => f.startsWith("admin") && f.endsWith(".tsx")),
    ...readdirSync("src/routes").filter((f) => f.startsWith("operator") && f.endsWith(".tsx")),
  ];

  it("каждая страница админки и оператора приписана к месту", () => {
    const empty = files.filter((f) => deskOf(f) == null);
    expect(empty).toEqual([]);
    expect(files.length).toBeGreaterThan(60);
  });

  it("место не пустует: склад, школа, оператор и общие страницы есть", () => {
    const used = new Set(files.map((f) => deskOf(f)));
    for (const d of DESKS) expect(used.has(d), d).toBe(true);
  });

  it("страницы склада не попали в каталог, вход остался общим", () => {
    expect(deskOf("admin._authed.warehouse.stocktake.tsx")).toBe("warehouse");
    expect(deskOf("admin._authed.products.tsx")).toBe("catalog");
    expect(deskOf("admin._authed.students.tsx")).toBe("school");
    expect(deskOf("admin._authed.broadcasts.tsx")).toBe("broadcast");
    expect(deskOf("admin._authed.v4-today.tsx")).toBe("today");
    expect(deskOf("admin.login.tsx")).toBe("shared");
    expect(deskOf("operator._authed.v4-attention.tsx")).toBe("operator");
    const counts = files.reduce<Record<string, number>>((acc, f) => {
      const d = deskOf(f) as Desk;
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.shared).toBeGreaterThan(5);
  });
});

describe("карта не обещает кнопку без действия", () => {
  it("страница Сегодня зовёт шаг выдачи и ответ продавца, а не модель", () => {
    const page = readFileSync("src/routes/admin._authed.v4-today.tsx", "utf8");
    expect(page).toContain("v4AdvanceFn");
    expect(page).toContain("v4ReplyFn");
    expect(page).not.toContain("runAgent");
  });
});
