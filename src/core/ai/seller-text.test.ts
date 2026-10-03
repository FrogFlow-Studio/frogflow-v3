import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { handoffSummary, type Note } from "./seller-text";

const NOTES: Note[] = [
  "accounting",
  "balance",
  "limit",
  "catalog",
  "failure",
  "budget",
  "empty",
  "slow",
  "price",
  "injection",
];

describe("сводка передачи менеджеру", () => {
  it("каждая причина есть на ru, kk, en, uz, отличается по языкам и несёт вопрос покупателя", () => {
    for (const note of NOTES) {
      const texts = SUPPORTED_LOCALES.map((l) => handoffSummary(l, note, "Сколько стоит?"));
      expect(new Set(texts).size, note).toBe(4);
      for (const t of texts) expect(t).toContain("«Сколько стоит?»");
    }
  });

  it("в en и uz нет кириллицы (кроме «» вопроса покупателя)", () => {
    for (const note of NOTES)
      for (const l of ["en", "uz"] as const)
        expect(handoffSummary(l, note, "x"), `${l}/${note}`).not.toMatch(/[А-Яа-яЁё]/);
  });

  it("консультант собирает все сводки менеджеру через handoffSummary, а не строкой по-русски", () => {
    const src = readFileSync("src/core/consultant/engine.server.ts", "utf8");
    // summary: `…` или summary: "…" с кириллицей — сводка по-русски мимо локали продавца.
    const russian = [...src.matchAll(/summary:\s*[`"']([^`"'\n]*)/g)]
      .map((m) => m[1]!)
      .filter((t) => /[А-Яа-яЁё]/.test(t));
    expect(russian).toEqual([]);
    expect(src).toContain("handoffSummary(");
  });
});
