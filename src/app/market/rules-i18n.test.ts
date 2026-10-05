import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { REPORT_LIMITS } from "@/core/marketplace/report";
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

  it("разделы: согласие, одобрение, скрытие, что показывается, заказ, обращение, жалоба", () => {
    expect(RULES_SECTIONS).toHaveLength(7);
    for (const s of RULES_SECTIONS) {
      expect(RULES_KEYS).toContain(`${s}.title`);
      expect(RULES_KEYS).toContain(`${s}.text`);
    }
  });

  it("не обещает того, чего нет: ни комиссии, ни оплаты на площадке", () => {
    for (const l of SUPPORTED_LOCALES) {
      const all = RULES_KEYS.map((k) => rulesT(l)(k))
        .join(" ")
        .toLowerCase();
      expect(all).not.toMatch(/комисси|commission|komissiya|комиссия/);
    }
  });

  it("раздел о жалобах называет предел из кода, а страница жалобы и правила связаны ссылками", () => {
    for (const l of SUPPORTED_LOCALES)
      expect(rulesT(l)("s7.text"), l).toContain(String(REPORT_LIMITS.perIpPerDay));
    const report = readFileSync("src/routes/market.report.tsx", "utf8");
    const rules = readFileSync("src/routes/market.rules.tsx", "utf8");
    // со страницы жалобы (и после отправки) — на раздел «Как рассматривается жалоба»
    expect(report.match(/to="\/market\/rules"[^>]*?hash="s7"/gs)?.length).toBe(2);
    expect(RULES_SECTIONS.at(-1)).toBe("s7");
    // якорь раздела на странице правил = ключ раздела
    expect(rules).toContain("id={k}");
  });
});
