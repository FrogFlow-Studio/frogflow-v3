import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { QUICK_REPLIES, QUICK_VARS, fillQuickReply, quickReplyText } from "./quick-replies";

const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("быстрые ответы: состав", () => {
  it("у каждого шаблона есть текст на всех четырёх языках", () => {
    for (const r of QUICK_REPLIES)
      for (const l of SUPPORTED_LOCALES)
        expect(r.text[l]?.trim().length, `${r.id}/${l}`).toBeGreaterThan(10);
  });

  it("переменные только из списка и одни и те же на всех языках", () => {
    for (const r of QUICK_REPLIES) {
      for (const l of SUPPORTED_LOCALES)
        for (const n of names(r.text[l]))
          expect(QUICK_VARS as readonly string[], `${r.id}/${l}: {${n}}`).toContain(n);
      for (const l of SUPPORTED_LOCALES)
        expect(names(r.text[l]), `${r.id}/${l}`).toEqual(names(r.text.ru));
    }
  });

  it("номера уникальны, подписи заполнены, длина влезает в сообщение поддержки", () => {
    expect(new Set(QUICK_REPLIES.map((r) => r.id)).size).toBe(QUICK_REPLIES.length);
    for (const r of QUICK_REPLIES) {
      expect(r.title.trim()).not.toBe("");
      for (const l of SUPPORTED_LOCALES) expect(r.text[l].length).toBeLessThan(1500);
    }
  });
});

describe("подстановка", () => {
  it("имя магазина и тариф подставляются", () => {
    expect(fillQuickReply("«{shop}», тариф {plan}.", { shop: "Лавка", plan: "Pro" })).toBe(
      "«Лавка», тариф Pro.",
    );
  });

  it("одна переменная несколько раз; чужое имя в скобках не трогается", () => {
    expect(fillQuickReply("{shop} и {shop} {secret}", { shop: "А" })).toBe("А и А {secret}");
  });

  it("нет значения — подстановка пустой строкой без висящего пробела", () => {
    expect(fillQuickReply("Спасибо. {plan}", { plan: "" })).toBe("Спасибо.");
    expect(fillQuickReply("Спасибо. {plan}", {})).toBe("Спасибо.");
  });

  it("язык клиента: казахский магазин получает казахский, незнакомый язык — русский", () => {
    const r = QUICK_REPLIES.find((x) => x.id === "done")!;
    const vars = { shop: "Дүкен", plan: "Pro" };
    expect(quickReplyText(r, "kk", vars)).toBe(fillQuickReply(r.text.kk, vars));
    expect(quickReplyText(r, "kk", vars)).toContain("Дүкен");
    expect(quickReplyText(r, null, vars)).toBe(fillQuickReply(r.text.ru, vars));
    expect(quickReplyText(r, "xx" as never, vars)).toBe(fillQuickReply(r.text.ru, vars));
  });

  it("каждый шаблон на каждом языке после подстановки без фигурных скобок", () => {
    const vars = { shop: "Лавка", plan: "Pro" };
    for (const r of QUICK_REPLIES)
      for (const l of SUPPORTED_LOCALES)
        expect(quickReplyText(r, l, vars), `${r.id}/${l}`).not.toMatch(/[{}]/);
  });
});
