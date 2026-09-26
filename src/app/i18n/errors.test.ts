import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { UserError } from "@/core/i18n/user-error";
import { ADMIN_DICTS, adminT } from "./admin";
import { adminErrorText } from "./user-error";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Все `new UserError("ключ", "шаблон"` в коде — ключ и русский шаблон. */
function userErrorsInCode(): Array<{ file: string; key: string; template: string }> {
  const found: Array<{ file: string; key: string; template: string }> = [];
  const re = /new UserError\(\s*"([^"]+)",\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/g;
  for (const file of sources("src")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re))
      found.push({ file, key: m[1]!, template: (m[2] ?? m[3] ?? "").replace(/\\"/g, '"') });
  }
  return found;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("словарь админки полный", () => {
  it("каждый ключ переведён на все языки, подстановки совпадают", () => {
    const ru = ADMIN_DICTS.ru as Record<string, string>;
    for (const l of SUPPORTED_LOCALES) {
      const d = ADMIN_DICTS[l] as Record<string, string>;
      const missing = Object.keys(ru).filter((k) => !d[k]);
      expect(missing, `нет перевода на ${l}`).toEqual([]);
      const broken = Object.keys(ru).filter(
        (k) => placeholders(d[k]!).join() !== placeholders(ru[k]!).join(),
      );
      expect(broken, `подстановки в ${l}`).toEqual([]);
    }
  });
});

describe("ошибки для продавца (UserError)", () => {
  it("каждая UserError в коде есть в словаре с тем же русским текстом", () => {
    const ru = ADMIN_DICTS.ru as Record<string, string>;
    const errors = userErrorsInCode();
    const wrong = errors.filter((e) => ru[e.key] !== e.template).map((e) => `${e.file}: ${e.key}`);
    expect(wrong).toEqual([]);
  });

  it("переводится на язык админки с подстановкой, чужая ошибка — как есть", () => {
    const ru = ADMIN_DICTS.ru as Record<string, string>;
    const key = Object.keys(ru)[0]!;
    const e = new UserError(key, ru[key]!);
    expect(adminErrorText("en", e)).toBe(adminT("en")(key as never));
    expect(adminErrorText("kk", new Error("boom"))).toBe("boom");
    expect(adminErrorText("uz", new UserError("нет.такого", "Текст {n}", { n: 2 }))).toBe(
      "Текст 2",
    );
  });
});

describe("модуль в тексте ошибки", () => {
  it("ключ модуля показывается названием на языке админки", () => {
    const e = new UserError(
      "err.auth.moduleOff",
      "Модуль «{module}» не подключён к вашему тарифу.",
      { module: "broadcasts" },
    );
    expect(adminErrorText("ru", e)).toBe("Модуль «Рассылки по базе» не подключён к вашему тарифу.");
    expect(adminErrorText("en", e)).not.toContain("broadcasts»");
  });
});
