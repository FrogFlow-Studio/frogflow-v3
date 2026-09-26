import { describe, expect, it } from "vitest";
import {
  isConsultantVertical,
  isFlowersVertical,
  isPhysicalShopVertical,
  verticalDef,
} from "./registry";

describe("ниши: витрина, физический чекаут и консультант, как в v1", () => {
  it("digital — магазин без физического чекаута", () => {
    expect(verticalDef("digital").mode).toBe("shop");
    expect(isPhysicalShopVertical("digital")).toBe(false);
  });

  it("confectionery — магазин с физическим чекаутом", () => {
    expect(verticalDef("confectionery").mode).toBe("shop");
    expect(isPhysicalShopVertical("confectionery")).toBe(true);
  });

  it("consultant — физические товары, но без чекаута кондитерской", () => {
    expect(verticalDef("consultant").defaultFulfillment).toBe("physical");
    expect(isConsultantVertical("consultant")).toBe(true);
    expect(isPhysicalShopVertical("consultant")).toBe(false);
  });

  it("flowers — магазин с физическим чекаутом и WhatsApp в мастере подключения", () => {
    expect(isPhysicalShopVertical("flowers")).toBe(true);
    expect(isFlowersVertical("flowers")).toBe(true);
    expect(verticalDef("flowers").suggestedModules).toContain("whatsapp");
  });
});
