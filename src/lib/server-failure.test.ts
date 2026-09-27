import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlatformFailure, SERVER_FAILED_TEXT, toScreenError } from "./server-fn-errors";
import { serverFailure } from "./server-failure";
import { screenErrorText } from "./shown-error";

const ru = async (e: { message: string }) => e.message;

describe("сбой с русским пояснением", () => {
  const dup =
    'Не удалось сохранить почту: duplicate key value violates unique constraint "bot_users_pkey"';

  it("на экран идёт общая фраза, а не текст базы; в Sentry — как сбой", async () => {
    const e = serverFailure(dup);
    expect(isPlatformFailure(e)).toBe(true);
    const shown = screenErrorText(await toScreenError(e, ru));
    expect(shown).toBe(SERVER_FAILED_TEXT);
    expect(shown).not.toContain("duplicate");
  });

  it("отказ человеку обычным Error с русским текстом по-прежнему виден как есть", async () => {
    const e = new Error("Логин «anna» уже используется.");
    expect(isPlatformFailure(e)).toBe(false);
    expect(screenErrorText(await toScreenError(e, ru))).toBe("Логин «anna» уже используется.");
  });

  it("в коде нет `new Error` с русским текстом и сообщением ошибки внутри — только serverFailure", () => {
    const files = execSync("git ls-files 'src/*.ts' 'src/*.tsx'", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => f && !/\.test\.tsx?$/.test(f));
    const leaks: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      // Шаблон целиком, включая вложенный шаблон внутри ${…}.
      for (const m of s.matchAll(
        /new Error\(\s*`((?:[^`$\\]|\\.|\$\{(?:[^{}`]|`[^`]*`)*\}|\$)*)`/g,
      )) {
        const body = m[1]!;
        if (/[А-Яа-яЁё]/.test(body) && /\$\{[^}]*\.message\b/.test(body))
          leaks.push(`${f}:${s.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
