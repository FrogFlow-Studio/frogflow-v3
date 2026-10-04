import { describe, expect, it } from "vitest";
import { ALWAYS_TESTS, plan, steps, verdict } from "../scripts/precheck.ts";

describe("npm run precheck", () => {
  const changed = [
    "src/core/inbox/page.ts",
    "src/core/inbox/page.test.ts",
    "src/routes/admin._authed.chat.tsx",
    "docs/ARCHITECTURE.md",
    "CLAUDE.md",
    "package.json",
    "tests/integration/chat.test.ts",
    "tests/e2e/money.spec.ts",
    "src/routeTree.gen.ts",
    "package-lock.json",
    "src/core/inbox/page.ts",
  ];

  it("форматирует всё, что понимает prettier, линтит только код; сгенерированное и повторы не берёт", () => {
    const p = plan(changed);
    expect(p.format).toEqual([
      "src/core/inbox/page.ts",
      "src/core/inbox/page.test.ts",
      "src/routes/admin._authed.chat.tsx",
      "docs/ARCHITECTURE.md",
      "CLAUDE.md",
      "package.json",
      "tests/integration/chat.test.ts",
      "tests/e2e/money.spec.ts",
    ]);
    expect(p.lint).toEqual([
      "src/core/inbox/page.ts",
      "src/core/inbox/page.test.ts",
      "src/routes/admin._authed.chat.tsx",
      "tests/integration/chat.test.ts",
      "tests/e2e/money.spec.ts",
    ]);
    expect(p.format).not.toContain("src/routeTree.gen.ts");
    expect(p.format).not.toContain("package-lock.json");
  });

  it("tests/integration и e2e не запускаются никогда: ни в related, ни в исключениях vitest", () => {
    const p = plan(changed);
    expect(p.related).toEqual([
      "src/core/inbox/page.ts",
      "src/core/inbox/page.test.ts",
      "src/routes/admin._authed.chat.tsx",
    ]);
    const cmds = steps(p).map((s) => s.cmd.join(" "));
    for (const cmd of cmds.filter((c) => c.includes("vitest"))) {
      expect(cmd).toContain("--exclude tests/integration/**");
      expect(cmd).toContain("--exclude tests/e2e/**");
    }
    expect(cmds.join("\n")).not.toMatch(/vitest (run|related) [^\n]*tests\/integration\/chat/);
  });

  it("всегда гонит src/lib и tests/db-columns.test.ts, даже когда изменений нет", () => {
    expect(ALWAYS_TESTS).toEqual([
      "src/lib",
      "tests/db-columns.test.ts",
      "tests/dialogs",
      "src/app/admin/audit-labels.test.ts",
      "src/app/admin/accountant-access.test.ts",
      "src/lib/cron-route.test.ts",
      "src/app/i18n",
    ]);
    const list = steps(plan([]));
    expect(list.map((s) => s.name)).toEqual([
      "e2e-скан",
      "typecheck",
      "tests (src/lib, db-columns)",
    ]);
    expect(list[2]!.cmd).toEqual(expect.arrayContaining(ALWAYS_TESTS));
  });

  it("порядок: prettier → eslint → e2e-скан → типы → тесты по изменённым → src/lib", () => {
    expect(steps(plan(["src/a.ts"])).map((s) => s.name)).toEqual([
      "prettier",
      "eslint",
      "e2e-скан",
      "typecheck",
      "tests (изменённые)",
      "tests (src/lib, db-columns)",
    ]);
  });

  it("последняя строка: «готово к PR» или что упало", () => {
    expect(verdict([{ name: "eslint", ok: true }])).toBe("готово к PR");
    expect(
      verdict([
        { name: "eslint", ok: true },
        { name: "typecheck", ok: false },
      ]),
    ).toBe("не готово к PR: упало typecheck");
  });
});
