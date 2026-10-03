import { describe, expect, it } from "vitest";
import { ENV_VARS, envReport } from "@/lib/env-report";
import { setEnvForTests, envPresence } from "@/config/env";
import { readFileSync } from "node:fs";

const REQUIRED = ENV_VARS.filter((v) => v.kind === "required").map((v) => v.name);

describe("envReport", () => {
  it("ok: false и имена недостающих, если нет обязательной", () => {
    const r = envReport(new Set(REQUIRED.filter((n) => n !== "CRON_SECRET")));
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toEqual(["CRON_SECRET"]);
    expect(r.vars.find((v) => v.name === "CRON_SECRET")).toMatchObject({
      kind: "required",
      set: false,
    });
  });

  it("ok: true при всех обязательных; функции без ключей — set: false, но не ошибка", () => {
    const r = envReport(new Set(REQUIRED));
    expect(r.ok).toBe(true);
    expect(r.missingRequired).toEqual([]);
    expect(r.vars.find((v) => v.name === "ZERNIO_API_KEY")).toMatchObject({
      kind: "feature",
      set: false,
    });
  });

  it("каждая запись: имя, kind, set и пояснение; значений нет", () => {
    for (const v of envReport(new Set(["SMTP_HOST"])).vars) {
      expect(Object.keys(v).sort()).toEqual(["kind", "name", "note", "set"]);
    }
    expect(envReport(new Set(["SMTP_HOST"])).vars.find((v) => v.name === "SMTP_HOST")?.set).toBe(
      true,
    );
  });

  it("все имена из списка есть в схеме config/env.ts, обязательные — без optional", () => {
    const src = readFileSync("src/config/env.ts", "utf8");
    for (const v of ENV_VARS) expect(src, v.name).toMatch(new RegExp(`\\b${v.name}:`));
    for (const n of REQUIRED) {
      const line = src.split("\n").find((l) => new RegExp(`^\\s*${n}:`).test(l)) ?? "";
      const block = src
        .slice(src.indexOf(line), src.indexOf(line) + 200)
        .split(/\n\s*\n|\/\*\*/)[0];
      expect(block, n).not.toMatch(/\.optional\(\)/);
    }
  });

  it("envPresence берёт имена из подменённого окружения и не отдаёт значения", () => {
    setEnvForTests({ ZERNIO_API_KEY: "secret-key" });
    const names = envPresence();
    expect(names.has("ZERNIO_API_KEY")).toBe(true);
    expect(names.has("SMTP_HOST")).toBe(false);
    expect([...names].join(",")).not.toContain("secret-key");
    setEnvForTests(undefined);
  });
});
