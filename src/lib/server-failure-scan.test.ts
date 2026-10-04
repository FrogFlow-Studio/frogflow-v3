import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ошибка базы наружу — только serverFailure: обычный Error с текстом PostgREST
 * экран показывает человеку как есть, с именами таблиц и ограничений.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("ошибки базы наружу", () => {
  it("нет `new Error(error.message)`: вместо него serverFailure", () => {
    const bad: string[] = [];
    const re =
      /new Error\(\s*(?:`[^`]*\$\{(?:error|e|err)\.message\}[^`]*`|(?:\w+\??\.)?(?:error|e|err|readError|dbError)\??\.message)\s*\)/;
    for (const f of walk("src")) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (re.test(line)) bad.push(`${f}:${i + 1}`);
        });
    }
    expect(bad, "замените на serverFailure(...) из @/lib/server-failure").toEqual([]);
  });
});
