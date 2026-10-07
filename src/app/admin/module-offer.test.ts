import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/core/modules/registry";
import { moduleOffered, SELLING_MODULES } from "./module-offer";

describe("«Модули»: что предлагаем консультанту без продаж", () => {
  it("каждый модуль из списка продаж есть в реестре", () => {
    for (const k of SELLING_MODULES) expect(MODULE_KEYS, k).toContain(k);
  });

  it("BOVI: оплату, витрину и склад не предлагаем, консультанта, рассылки и каналы — да", () => {
    const bovi = { modules: { shop: true, dm_shop: true }, sells: false };
    for (const k of ["stripe", "kaspi_pay", "web_storefront", "warehouse", "coupons"] as const)
      expect(moduleOffered(k, bovi), k).toBe(false);
    for (const k of ["broadcasts", "instagram", "whatsapp", "multi_language", "courses"] as const)
      expect(moduleOffered(k, bovi), k).toBe(true);
    // Уже включённый виден: продавец видит, что у него есть.
    expect(moduleOffered("stripe", { modules: { stripe: true }, sells: false })).toBe(true);
  });

  it("продаёт или не сказано — предлагаем всё, как раньше", () => {
    for (const sells of [true, undefined])
      expect(MODULE_KEYS.every((k) => moduleOffered(k, { modules: {}, sells }))).toBe(true);
  });
});
