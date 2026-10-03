import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Каждый вызов notifyAdminsHtml называет вид события (`kind`) — иначе он идёт
 * мимо матрицы «событие → канал»: тихие часы и выключенные продавцом виды на
 * него не действуют, а в дайджест он не откладывается. Вид может прийти и
 * готовым объектом опций (`opts`, `...opts`) — тогда проверяем, что в файле
 * этот объект с `kind` есть.
 */
function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

/** Текст аргументов вызова от `(` до парной `)`: строки и шаблоны не считаются. */
export function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "`") {
      for (i++; i < src.length && src[i] !== "`"; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "$" && src[i + 1] === "{") {
          const inner = callArgs(src, i + 1).length; // скобки {…} внутри шаблона
          i += inner - 1;
        }
      }
    } else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

describe("notifyAdminsHtml: у каждого вызова есть вид события", () => {
  it("находит вызовы без kind", () => {
    const bad: string[] = [];
    let calls = 0;
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bnotifyAdminsHtml\(/g)) {
        const before = src.slice(Math.max(0, m.index! - 16), m.index!);
        if (/function\s+$/.test(before)) continue; // объявление
        calls++;
        const args = callArgs(src, m.index! + m[0].length - 1);
        const passesOpts = /,\s*(\.\.\.)?\w+\s*\)$/.test(args) || /\{\s*\.\.\./.test(args);
        const ok = /\bkind\b/.test(args) || (passesOpts && /\bkind\b/.test(src));
        if (!ok) bad.push(`${f}:${src.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(calls).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("сканер понимает шаблоны со вложенными скобками", () => {
    const s = "f(ctx, `a ${g(1, { x: 2 })} b`, { kind: 'x' })";
    expect(callArgs(s, 1)).toBe(s.slice(1));
    expect(callArgs("f(a, `)`)", 1)).toBe("(a, `)`)");
  });
});
