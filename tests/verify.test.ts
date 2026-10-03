import { describe, expect, it } from "vitest";
import { LIVE_KEYS, steps, summary, withoutLiveKeys } from "../scripts/verify.ts";

describe("npm run verify", () => {
  it("запускает шаг под env -u для каждого ключа живой базы", () => {
    const cmd = withoutLiveKeys(["npm", "test"]);
    expect(cmd.slice(0, 1)).toEqual(["env"]);
    expect(cmd.slice(-2)).toEqual(["npm", "test"]);
    for (const key of LIVE_KEYS) expect(cmd[cmd.indexOf(key) - 1]).toBe("-u");
  });

  it("сборка — отдельные шаги, и без неё их нет; типы второй раз не гоняются", () => {
    expect(steps(true).map((s) => s.name)).toEqual([
      "lint",
      "typecheck",
      "test",
      "build",
      "build-output",
      "certificate-output",
      "vercel-output",
    ]);
    expect(steps(false).map((s) => s.name)).toEqual(["lint", "typecheck", "test"]);
  });

  it("сводка называет упавший шаг и не запускавшиеся", () => {
    const text = summary(
      [
        { name: "lint", ok: true, seconds: 3 },
        { name: "typecheck", ok: false, seconds: 9 },
      ],
      "abc1234",
      ["test", "build"],
    );
    expect(text).toContain("abc1234");
    expect(text).toContain("❌ typecheck");
    expect(text).toContain("⏭ test");
    expect(text).toContain("Упало: typecheck.");
  });

  it("сводка зелёного прогона", () => {
    const text = summary([{ name: "lint", ok: true, seconds: 1 }], "abc", []);
    expect(text).toContain("Всё зелёное.");
  });
});

describe("сборка Vercel в verify", () => {
  it("обычный шаг сертификата смотрит .output, Vercel-сборка — отдельным шагом после него", () => {
    const list = steps(true);
    const names = list.map((s) => s.name);
    expect(names.indexOf("vercel-output")).toBeGreaterThan(names.indexOf("certificate-output"));
    expect(list.find((s) => s.name === "certificate-output")!.cmd.at(-1)).toBe(".output/server");
  });

  it("собирает пресетом vercel и проверяет обе проверки по временной папке", async () => {
    const { VERCEL_BUILD, checks } = await import("../scripts/vercel-output.ts");
    expect(VERCEL_BUILD).toContain("NITRO_PRESET=vercel");
    const cs = checks("/tmp/x/output/functions");
    expect(cs.map((c) => c.name)).toEqual(["check-vercel-output", "certificate-output"]);
    for (const c of cs) expect(c.cmd.at(-1)).toBe("/tmp/x/output/functions");
  });
});
