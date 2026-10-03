import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { OWNER_TEMPLATE_TITLES, ownerTemplates } from "./owner-templates";

describe("шаблоны сообщений владельцу", () => {
  it("каждый шаблон есть на ru, kk, en, uz, с названием магазина и без «дыр»", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const list = ownerTemplates(locale, { shop: "Лавка", paidUntil: "20.10.2026" });
      expect(list.map((t) => t.key).sort()).toEqual(Object.keys(OWNER_TEMPLATE_TITLES).sort());
      for (const t of list) {
        expect(t.text, `${locale}/${t.key}`).toContain("Лавка");
        expect(t.text).not.toMatch(/undefined|null|\$\{/);
      }
    }
  });
  it("тексты на разных языках разные, срок оплаты подставляется", () => {
    const by = (l: "ru" | "kk" | "en" | "uz") =>
      ownerTemplates(l, { shop: "S", paidUntil: "20.10.2026" }).find((t) => t.key === "payment")!
        .text;
    expect(new Set(SUPPORTED_LOCALES.map(by)).size).toBe(4);
    for (const l of SUPPORTED_LOCALES) expect(by(l)).toContain("20.10.2026");
  });
  it("срока нет — напоминание без даты, но не пустое", () => {
    const t = ownerTemplates("en", { shop: "S", paidUntil: null }).find(
      (x) => x.key === "payment",
    )!;
    expect(t.text).toContain("about to end");
  });
});
