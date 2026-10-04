import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicFns, type PublicFn } from "../../tests/public-functions-scan";

/**
 * Таблица docs/SECURITY-PUBLIC.md и код: каждая серверная функция без гварда продавца и оператора
 * описана строкой (кто вызывает, что проверяет, лимит, что отдаёт, тест), и каждая строка верна.
 * Новая публичная функция без строки валит этот тест.
 */
const DOC = readFileSync("docs/SECURITY-PUBLIC.md", "utf8");

type Row = {
  id: string;
  caller: string;
  check: string[];
  limit: string;
  gives: string;
  test: string;
};

const cell = (s: string) => s.trim();
const refs = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

function rows(): Row[] {
  const out: Row[] = [];
  for (const line of DOC.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const c = line
      .slice(1, line.lastIndexOf("|"))
      .split("|")
      .map((x) => cell(x));
    expect(c, line).toHaveLength(6);
    out.push({
      id: refs(c[0]!)[0]!,
      caller: c[1]!,
      check: refs(c[2]!),
      limit: c[3]!,
      gives: c[4]!,
      test: refs(c[5]!)[0] ?? "",
    });
  }
  return out;
}

const ROWS = rows();
const FNS = new Map(publicFns().map((f) => [f.id, f]));

/** Файл из ссылки `путь::признак`: от src/, от src/app/ или рядом с файлом функции. */
function resolve(path: string, fn?: PublicFn): string | null {
  const candidates = [path, `src/${path}`, `src/app/${path}`];
  if (fn) candidates.push(join(dirname(fn.file), path));
  return candidates.find((p) => existsSync(p)) ?? null;
}

const LIMITS =
  /\b(takeWeb|takeCourse|takeMiniApp|loginDelay|loginLocked|consumeWebQuota|ipHash|submitReport|submitOpenRequest|signupRefusal)\b/;

describe("публичные серверные функции: таблица и код", () => {
  it("таблица прочитана, строки не повторяются", () => {
    expect(ROWS.length).toBeGreaterThan(70);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });

  it("каждая публичная функция описана в docs/SECURITY-PUBLIC.md и наоборот", () => {
    const inCode = [...FNS.keys()].sort();
    const inDoc = ROWS.map((r) => r.id).sort();
    expect(
      inCode.filter((i) => !inDoc.includes(i)),
      "функции без строки в docs/SECURITY-PUBLIC.md",
    ).toEqual([]);
    expect(
      inDoc.filter((i) => !inCode.includes(i)),
      "строки без публичной функции в коде (удалена или получила гвард)",
    ).toEqual([]);
  });

  for (const r of ROWS) {
    const fn = FNS.get(r.id);
    describe(r.id, () => {
      it("все колонки заполнены", () => {
        expect(r.caller.length).toBeGreaterThan(5);
        expect(r.check.length).toBeGreaterThan(0);
        expect(r.gives.length).toBeGreaterThan(10);
        expect(r.test).toContain("::");
      });

      it("названная проверка есть в коде", () => {
        if (!fn) return;
        for (const ref of r.check) {
          const [path, needle] = ref.includes("::") ? ref.split("::") : [null, ref];
          if (path) {
            const file = resolve(path, fn);
            expect(file, `${r.id}: файл ${path}`).not.toBeNull();
            expect(readFileSync(file!, "utf8"), `${r.id}: ${ref}`).toContain(needle);
          } else expect(fn.text, `${r.id}: ${ref}`).toContain(needle);
        }
      });

      it("лимит назван и есть в коде, либо объяснено, почему его нет", () => {
        if (!fn) return;
        if (r.limit.startsWith("нет:")) {
          expect(r.limit.length, `${r.id}: объясните, почему лимита нет`).toBeGreaterThan(15);
          return;
        }
        const names = r.limit.match(LIMITS);
        expect(names, `${r.id}: лимит не назван`).not.toBeNull();
        // Лимит может жить в серверном модуле, названном в «Что проверяет».
        let scope = fn.text;
        for (const ref of r.check) {
          const file = ref.includes("::") ? resolve(ref.split("::")[0]!, fn) : null;
          if (file) scope += readFileSync(file, "utf8");
        }
        const found = [...r.limit.matchAll(new RegExp(LIMITS, "g"))].some((m) =>
          scope.includes(m[0]),
        );
        expect(found, `${r.id}: ${r.limit}`).toBe(true);
      });

      it("тест существует и содержит названную строку", () => {
        const [path, needle] = r.test.split("::");
        const file = resolve(path!);
        expect(file, `${r.id}: файл теста ${path}`).not.toBeNull();
        expect(readFileSync(file!, "utf8"), `${r.id}: ${r.test}`).toContain(needle);
      });
    });
  }
});
