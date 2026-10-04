import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { RULES_KEYS, RULES_SECTIONS, rulesT } from "./rules-i18n";

describe("правила площадки: тексты", () => {
  it("каждый ключ есть на всех четырёх языках и переведён", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = rulesT(l);
      for (const k of RULES_KEYS) {
        expect(t(k), `${l}: ${k}`).toBeTruthy();
        if (l !== "ru") expect(t(k), `${l}: ${k}`).not.toBe(rulesT("ru")(k));
      }
    }
  });

  it("разделы: согласие, одобрение, скрытие, что показывается, заказ, жалоба", () => {
    expect(RULES_SECTIONS).toHaveLength(6);
    for (const s of RULES_SECTIONS) {
      expect(RULES_KEYS).toContain(`${s}.title`);
      expect(RULES_KEYS).toContain(`${s}.text`);
    }
  });

  it("не обещает того, чего нет: ни кнопки жалобы, ни комиссии, ни оплаты на площадке", () => {
    for (const l of SUPPORTED_LOCALES) {
      const all = RULES_KEYS.map((k) => rulesT(l)(k))
        .join(" ")
        .toLowerCase();
      expect(all).not.toMatch(/комисси|commission|komissiya|комиссия/);
      expect(all).not.toMatch(/пожаловат|report button/);
    }
  });
});
