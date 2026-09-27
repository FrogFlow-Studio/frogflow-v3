import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULE_KEYS, availableModules, moduleDef } from "./registry";

/**
 * Предохранитель из v1 (история `wa_broadcasts`): модуль в прайсе
 * «available» и продаётся, а тумблер не читает ни один серверный путь —
 * выключить его неплатящему клиенту технически нельзя.
 *
 * Проверка нарочно грубая: ключ модуля должен встречаться вне реестра как
 * чтение тумблера (`modules.key`, `modules["key"]`) или строкой в вызове
 * гейта (`requireModule("key")`, `platform === "whatsapp" ? "wa_shop" : …`).
 * Доказывает «гейт где-то есть», а не «гейт стоит там, где нужно».
 */
const SRC = resolve(__dirname, "../..");
const REGISTRY = resolve(__dirname, "registry.ts");

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) sources(full, out);
    else if (
      /\.(ts|tsx)$/.test(e.name) &&
      !/\.test\.tsx?$/.test(e.name) &&
      e.name !== "routeTree.gen.ts" &&
      // В реестре каждый ключ объявлен (и в requires) — он «гейтом» не считается.
      full !== REGISTRY
    )
      out.push(full);
  }
  return out;
}

const code = sources(SRC)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

function gatedSomewhere(key: string): boolean {
  return new RegExp(`\\.modules\\??\\.${key}\\b|["'\`]${key}["'\`]`).test(code);
}

describe("реестр модулей: у каждого проданного модуля есть серверный гейт", () => {
  const paidAvailable = MODULE_KEYS.filter((k) => {
    const d = moduleDef(k);
    return d.status === "available" && d.price !== null;
  });

  it("нашёл хотя бы один платный доступный модуль для проверки", () => {
    // Станет 0 — проверка ниже молча ничего не проверит.
    expect(paidAvailable.length).toBeGreaterThan(0);
  });

  it.each(paidAvailable)("%s без флага клиента не действует, с флагом — действует", (key) => {
    expect(availableModules({})[key]).toBe(false);
    expect(availableModules({ [key]: false })[key]).toBe(false);
    expect(availableModules({ [key]: true })[key]).toBe(true);
  });

  it.each(paidAvailable)("%s читается хотя бы в одном серверном пути", (key) => {
    expect(gatedSomewhere(key)).toBe(true);
  });
});
