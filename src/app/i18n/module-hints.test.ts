import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/core/modules/registry";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { adminT, type AdminKey } from "./admin";

/** Подсказка модуля — коротко: одна-две строки, не абзац (А9). */
export const HINT_MAX = 160;

describe("подсказки модулей", () => {
  for (const l of SUPPORTED_LOCALES)
    it(`${l}: у каждого модуля подсказка есть и не длиннее ${HINT_MAX} символов`, () => {
      const t = adminT(l);
      for (const k of MODULE_KEYS) {
        const key = `module.${k}.desc` as AdminKey;
        const v = t(key);
        expect(v, `${l} ${key}: нет перевода`).not.toBe(key);
        expect(v.length, `${l} ${key}: ${v.length} символов`).toBeLessThanOrEqual(HINT_MAX);
      }
    });
});
