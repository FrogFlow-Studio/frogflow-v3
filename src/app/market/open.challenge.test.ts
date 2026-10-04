import { describe, expect, it } from "vitest";
import { issueChallenge, verifyChallenge, REFRESH } from "@/app/signup/challenge";
import { openT, OPEN_KEYS } from "./open-i18n";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

describe("задача формы «Открыть свой магазин»", () => {
  const now = 1_800_000_000_000;
  const later = now + 10_000;

  it("задача площадки проходит у площадки и не подходит регистрации и оформлению заказа", () => {
    const c = issueChallenge("secret", now, "market");
    expect(verifyChallenge("secret", c, "0", later, 0, "market")).toBeNull();
    expect(verifyChallenge("secret", c, "0", later, 0, "signup")).toBe(REFRESH);
    expect(verifyChallenge("secret", c, "0", later, 0, "checkout")).toBe(REFRESH);
  });

  it("задача регистрации не подходит площадке", () => {
    const c = issueChallenge("secret", now, "signup");
    expect(verifyChallenge("secret", c, "0", later, 0, "market")).toBe(REFRESH);
  });
});

describe("словарь страницы «Открыть свой магазин»", () => {
  it("каждый ключ переведён на каждом языке", () => {
    for (const l of SUPPORTED_LOCALES)
      for (const k of OPEN_KEYS) {
        const text = openT(l)(k);
        expect(text, `${l}: ${k}`).toBeTruthy();
        if (l !== "ru" && !k.startsWith("tier.") && !["field.instagram", "step.tier"].includes(k))
          expect(text, `${l}: ${k}`).not.toBe(openT("ru")(k));
      }
  });
  it("цены подставляются", () => {
    expect(openT("en")("tier.price", { setup: "15 000 ₸", monthly: "9 900 ₸" })).toBe(
      "Setup 15 000 ₸, then 9 900 ₸ per month",
    );
  });
});
