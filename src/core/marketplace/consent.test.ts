import { describe, expect, it } from "vitest";
import {
  marketplaceCategory,
  marketplaceCity,
  marketplaceState,
  shownOnMarketplace,
} from "./consent";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant, TenantSettings } from "@/core/tenant/types";

const shop = (settings: TenantSettings, vertical = "cake") =>
  ({ settings, vertical }) as unknown as Tenant;
const V2 = { served_by: "v2" } as const;

describe("согласие магазина на площадку", () => {
  it("по умолчанию выключено", () => {
    expect(marketplaceState(shop({ ...V2 }))).toBe("off");
    expect(shownOnMarketplace(shop({ ...V2 }))).toBe(false);
  });

  it("согласие без одобрения оператора — ожидает, но не показывается", () => {
    const t = shop({ ...V2, marketplace: { listed: true } });
    expect(marketplaceState(t)).toBe("pending");
    expect(shownOnMarketplace(t)).toBe(false);
  });

  it("согласие и одобрение — показывается", () => {
    expect(shownOnMarketplace(shop({ ...V2, marketplace: { listed: true, approved: true } }))).toBe(
      true,
    );
  });

  it("оператор скрыл — не показывается, даже если магазин включил и одобрен", () => {
    const t = shop({ ...V2, marketplace: { listed: true, approved: true, hidden: true } });
    expect(marketplaceState(t)).toBe("hidden");
    expect(shownOnMarketplace(t)).toBe(false);
  });

  it("клиент прежней платформы и клиент без served_by не участвуют", () => {
    const m = { listed: true, approved: true };
    expect(shownOnMarketplace(shop({ served_by: "v1", marketplace: m }))).toBe(false);
    expect(shownOnMarketplace(shop({ marketplace: m }))).toBe(false);
  });

  it("категория — своя или ниша; город — как записан", () => {
    expect(marketplaceCategory(shop({ marketplace: { category: "Торты на заказ" } }))).toBe(
      "Торты на заказ",
    );
    expect(marketplaceCategory(shop({}, "confectionery"))).toBe("Кондитерская");
    expect(marketplaceCity(shop({ marketplace: { city: "Алматы" } }))).toBe("Алматы");
    expect(marketplaceCity(shop({}))).toBe("");
  });
});

describe("чтение настроек площадки", () => {
  it("известные ключи читаются, мусор отбрасывается", () => {
    expect(
      settingsFromJson({
        marketplace: { listed: true, hidden: "yes", approved: true, city: "  Астана ", x: 1 },
      }).marketplace,
    ).toEqual({ listed: true, approved: true, city: "Астана" });
  });

  it("пустое и не объект не оставляют ключа", () => {
    expect(settingsFromJson({ marketplace: {} }).marketplace).toBeUndefined();
    expect(settingsFromJson({ marketplace: "x" }).marketplace).toBeUndefined();
    expect(settingsFromJson({ marketplace: { listed: false } }).marketplace).toBeUndefined();
  });
});
