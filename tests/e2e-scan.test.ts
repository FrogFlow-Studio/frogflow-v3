import { describe, expect, it } from "vitest";
import {
  currentBaseline,
  duplicateExports,
  everyFileListed,
  fixturesShape,
  load,
  looseRoleNames,
  scan,
  seedShape,
  testTitles,
} from "../scripts/e2e-scan.ts";

describe("имена тестов", () => {
  it("находит test, test.only и повтор в одном файле", () => {
    const src = `test("а", async () => {});\ntest.only('б', () => {});\n/* test("в") */\ntest("а", () => {});`;
    expect(testTitles(src)).toEqual(["а", "б", "а"]);
  });
});

describe("getByRole с name", () => {
  it("строка без exact считается, с exact и регулярка — нет", () => {
    const src = [
      `page.getByRole("button", { name: "Войти" })`,
      `page.getByRole("button", { name: "Войти", exact: true })`,
      `page.getByRole("link", { name: /Айгерим/ })`,
      `page.getByRole("table")`,
    ].join("\n");
    expect(looseRoleNames(src)).toBe(1);
  });
});

describe("общий seed.ts", () => {
  const ok = `import { stubDb, type StubDb } from "./pg-stub.ts";
import { seedBase } from "./seed/base.ts";
import { seedShop } from "./seed/shop.ts";

export function seedDb(): StubDb {
  const db = stubDb();
  const now = new Date().toISOString();
  seedBase(db);
  seedShop(db, now);
  return db;
}`;
  it("только импорт и вызов — чисто", () => {
    expect(seedShape(ok)).toEqual([]);
  });
  it("логика в общем файле, повтор вызова и импорт без вызова", () => {
    const bad = ok
      .replace("  return db;", "  db.tables.x = [];\n  seedShop(db, now);\n  return db;")
      .replace(
        "import { seedShop }",
        'import { seedShop2 } from "./seed/shop2.ts";\nimport { seedShop }',
      );
    const p = seedShape(bad);
    expect(p.some((x) => x.includes("только импорт и вызов раздела"))).toBe(true);
    expect(p.some((x) => x.includes("seedShop вызван 2 раза"))).toBe(true);
    expect(p.some((x) => x.includes("seedShop2") && x.includes("не вызван"))).toBe(true);
  });
});

describe("общий fixtures.ts", () => {
  it("export * — чисто, чужая строка и повтор — замечания", () => {
    expect(fixturesShape(`/** шапка */\nexport * from "./fixtures/a.ts";`)).toEqual([]);
    const p = fixturesShape(
      `export * from "./fixtures/a.ts";\nexport * from "./fixtures/a.ts";\nexport const X = 1;`,
    );
    expect(p).toHaveLength(2);
  });
  it("файл раздела без строки в общем и одинаковое имя в двух файлах", () => {
    expect(
      everyFileListed(
        "fixtures",
        ["a.ts", "b.ts"],
        `export * from "./fixtures/a.ts";`,
        "fixtures.ts",
      ),
    ).toEqual(["fixtures.ts: файл fixtures/b.ts не подключён в fixtures.ts"]);
    expect(
      duplicateExports({
        "f/a.ts": "export const SHOP_ID = 1;",
        "f/b.ts": "export const SHOP_ID = 2;",
      }),
    ).toHaveLength(1);
  });
});

describe("сквозные тесты репозитория", () => {
  it("скан чистый: имена, exact, общие файлы и экспорты", () => {
    expect(scan(load())).toEqual([]);
  });

  it("новый файл с name без exact падает, пока его нет в baseline", () => {
    const input = load();
    input.specs["tests/e2e/new.spec.ts"] =
      `test("x", async () => { page.getByRole("button", { name: "Ок" }); });`;
    expect(scan(input).join("\n")).toContain(
      "tests/e2e/new.spec.ts: getByRole с name без exact: true",
    );
  });

  it("baseline не отстаёт: счётчики в файле совпадают с кодом", () => {
    const input = load();
    expect(input.baseline).toEqual(currentBaseline(input.specs));
  });
});
