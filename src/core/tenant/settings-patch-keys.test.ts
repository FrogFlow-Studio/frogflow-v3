import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Каждый верхний ключ, который код пишет через patchTenantSettings, должен
 * быть в TenantSettings и читаться обратно: ключ без чтения settingsFromJson
 * молча отбрасывает, и запись «сохранилась», а прочесть её нечем.
 * Ключи, которые v2 лишь хранит для v1, перечислены отдельно.
 */
const V1_ONLY = new Set<string>(["rev", "on_overdue", "grace_days"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Верхние ключи литерала `{ ... }`, начинающегося с позиции open. */
function topKeys(src: string, open: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = open;
  let token = "";
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
    }
    if (depth === 1) {
      if (c === "," || c === "{") token = "";
      else if (c === ":") {
        const k = token.trim().replace(/^["']|["']$/g, "");
        if (/^[A-Za-z_]\w*$/.test(k)) keys.push(k);
        token = "";
      } else token += c;
    }
  }
  // `{ ключ }` без двоеточия
  const body = src.slice(open + 1, i);
  if (!body.includes(":") && /^\s*[A-Za-z_]\w*\s*,?\s*$/.test(body))
    keys.push(body.replace(/[\s,]/g, ""));
  return keys;
}

/** Верхние ключи `export type TenantSettings = { ... }` из types.ts. */
function typedKeys(): string[] {
  const src = readFileSync("src/core/tenant/types.ts", "utf8");
  const start = src.indexOf("export type TenantSettings = {");
  const open = src.indexOf("{", start);
  return topKeysTyped(src, open);
}

/** То же для типа: ключи с `?:` и `:` на первом уровне, комментарии пропускаем. */
function topKeysTyped(src: string, open: number): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") i = src.indexOf("*/", i) + 1;
    else if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i);
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(open, i);
  // ключи — в начале строки на глубине 1: считаем по строкам
  let d = 0;
  let inComment = false;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (inComment) {
      if (t.includes("*/")) inComment = false;
      continue;
    }
    if (t.startsWith("/*")) {
      if (!t.includes("*/")) inComment = true;
      continue;
    }
    if (d === 1) {
      const m = /^([A-Za-z_]\w*)\??:/.exec(t);
      const key = m?.[1];
      if (key) keys.push(key);
    }
    for (const c of line.replace(/\/\/.*$/, "")) {
      if (c === "{" || c === "[" || c === "(") d++;
      else if (c === "}" || c === "]" || c === ")") d--;
    }
  }
  return keys;
}

function patchedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk("src")) {
    const src = readFileSync(file, "utf8");
    const re = /patchTenantSettings\(\s*[\w.]+\s*,\s*\{/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      for (const k of topKeys(src, m.index + m[0].length - 1))
        if (!found.has(k)) found.set(k, file);
    }
  }
  return found;
}

describe("ключи patchTenantSettings", () => {
  const keys = patchedKeys();

  it("сканер находит записи", () => {
    expect(keys.size).toBeGreaterThan(20);
    expect(keys.has("collections")).toBe(true);
  });

  const typed = new Set(typedKeys());

  it("в types.ts нашлись ключи TenantSettings", () => {
    expect(typed.size).toBeGreaterThan(30);
    expect(typed.has("slug")).toBe(true);
  });

  for (const [key, file] of keys) {
    if (V1_ONLY.has(key)) continue;
    it(`${key} (${file}): типизирован в TenantSettings`, () => {
      expect(
        typed.has(key),
        `${key}: пишется через patchTenantSettings, но его нет в TenantSettings (types.ts) и в settingsFromJson`,
      ).toBe(true);
    });
  }

  it("каждый записываемый ключ TenantSettings есть в settings-roundtrip.test.ts", () => {
    const rt = readFileSync("src/core/tenant/settings-roundtrip.test.ts", "utf8");
    for (const key of keys.keys()) {
      if (V1_ONLY.has(key)) continue;
      expect(
        new RegExp(`\\b${key}\\s*:`).test(rt),
        `${key}: нет в ALL settings-roundtrip.test.ts`,
      ).toBe(true);
    }
  });
});
