import { describe, expect, it } from "vitest";
import { calculate, quoteTier, type CalcChannel } from "./calculator";
import {
  ADDON_MONTHLY_PRICE,
  ANNUAL_BILLED_MONTHS,
  CONNECTION_PRICE,
  MONTHLY_PRICE,
  PLAN_MODULES,
  PLAN_NICHES,
  PLAN_TIERS,
} from "./registry";

/** Калькулятор против реестра: каждая ниша, тариф и набор каналов. */
const CHANNEL_SETS: CalcChannel[][] = [
  ["telegram"],
  ["telegram", "instagram"],
  ["telegram", "whatsapp"],
  ["telegram", "instagram", "whatsapp"],
];

/** Канал входит в тариф, если модуль канала есть в планах ниши до этого тарифа включительно. */
function includedBy(niche: (typeof PLAN_NICHES)[number], tier: (typeof PLAN_TIERS)[number]) {
  const upTo = PLAN_TIERS.slice(0, PLAN_TIERS.indexOf(tier) + 1);
  const mods = new Set(upTo.flatMap((t) => PLAN_MODULES[niche][t]));
  return { whatsapp: mods.has("whatsapp"), instagram: mods.has("instagram") };
}

describe("калькулятор тарифа (Б31)", () => {
  for (const niche of PLAN_NICHES)
    for (const tier of PLAN_TIERS)
      for (const set of CHANNEL_SETS)
        for (const annual of [false, true])
          it(`${niche} ${tier} ${set.join("+")} ${annual ? "год" : "месяц"}`, () => {
            const inc = includedBy(niche, tier);
            const picked = (["whatsapp", "instagram"] as const).filter((k) => set.includes(k));
            const extra = picked.filter((k) => !inc[k]);
            const monthly = MONTHLY_PRICE[tier] + extra.length * ADDON_MONTHLY_PRICE.whatsapp;
            const q = quoteTier(niche, tier, set, annual);
            expect(q.extra.sort()).toEqual([...extra].sort());
            expect(q.included.length + q.extra.length).toBe(picked.length);
            expect(q.monthly).toBe(monthly);
            expect(q.yearTotal).toBe(monthly * ANNUAL_BILLED_MONTHS);
            expect(q.yearSaving).toBe(monthly * (12 - ANNUAL_BILLED_MONTHS));
            expect(q.perMonth).toBe(
              annual ? Math.round((monthly * ANNUAL_BILLED_MONTHS) / 12) : monthly,
            );
            expect(q.connection).toBe(annual ? 0 : CONNECTION_PRICE[tier]);
          });

  it("только Telegram: Basic без доплат, он же рекомендован", () => {
    const r = calculate("confectionery", ["telegram"], false);
    expect(r.recommended).toBe("basic");
    expect(r.quotes.map((q) => q.monthly)).toEqual([9_900, 19_900, 39_900]);
  });

  it("кондитерская: оба канала — Basic с двумя доплатами, Business включает оба", () => {
    const r = calculate("confectionery", ["telegram", "instagram", "whatsapp"], false);
    expect(r.quotes[0]).toMatchObject({ tier: "basic", monthly: 19_900 });
    expect(r.quotes[2]).toMatchObject({ tier: "business", monthly: 39_900, extra: [] });
    expect(r.recommended).toBe("basic");
  });

  it("цветы: WhatsApp входит уже в Basic, без доплаты", () => {
    const q = quoteTier("flowers", "basic", ["telegram", "whatsapp"], false);
    expect(q.included).toEqual(["whatsapp"]);
    expect(q.monthly).toBe(9_900);
  });

  it("годовая оплата: два месяца в подарок", () => {
    const q = quoteTier("digital", "pro", ["telegram"], true);
    expect(q.yearTotal).toBe(199_000);
    expect(q.yearSaving).toBe(2 * 19_900);
    expect(q.perMonth).toBe(Math.round(199_000 / 12));
  });
});
