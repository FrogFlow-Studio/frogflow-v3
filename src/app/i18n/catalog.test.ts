import { describe, expect, it } from "vitest";
import { ADMIN_DICTS } from "./admin";
import * as catalog from "./admin/catalog";
import { MODULE_KEYS, moduleDef } from "@/core/modules/registry";
import { VERTICAL_KEYS, verticalDef } from "@/core/verticals/registry";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

const ru: Record<string, string> = catalog.ru;

describe("каталог модулей и ниш в админке", () => {
  it("у каждого модуля есть название, описание и раздел — как в реестре", () => {
    for (const k of MODULE_KEYS) {
      const d = moduleDef(k);
      expect(ru[catalog.moduleTitleKey(k)], k).toBe(d.title);
      expect(ru[catalog.moduleDescKey(k)], k).toBe(d.desc);
      expect(ru[catalog.moduleGroupKey(k)], k).toBe(d.group);
    }
  });

  it("у каждой ниши есть название — как в реестре", () => {
    for (const v of VERTICAL_KEYS)
      expect(ru[catalog.verticalTitleKey(v)], v).toBe(verticalDef(v).title);
  });

  it("в словаре нет ключей для удалённых модулей и ниш", () => {
    const expected = new Set<string>([
      ...MODULE_KEYS.flatMap((k) => [
        catalog.moduleTitleKey(k),
        catalog.moduleDescKey(k),
        catalog.moduleGroupKey(k),
      ]),
      ...VERTICAL_KEYS.map((v) => catalog.verticalTitleKey(v)),
    ]);
    expect(Object.keys(ru).filter((key) => !expected.has(key))).toEqual([]);
  });

  it("все языки переведены и подключены к словарю админки", () => {
    for (const l of SUPPORTED_LOCALES) {
      const dict: Record<string, string> = catalog[l];
      for (const key of Object.keys(ru)) {
        expect(dict[key]?.trim(), `${l}: ${key}`).toBeTruthy();
        expect(ADMIN_DICTS[l][key as keyof (typeof ADMIN_DICTS)[typeof l]]).toBe(dict[key]);
      }
    }
  });
});
