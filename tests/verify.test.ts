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
