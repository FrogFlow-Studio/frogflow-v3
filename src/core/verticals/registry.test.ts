import { describe, expect, it } from "vitest";
import {
  isConsultantVertical,
  isFlowersVertical,
  isCoursesVertical,
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

  it("courses — онлайн-школа: цифровой магазин с курсами и закрытым каналом", () => {
    expect(verticalDef("courses").mode).toBe("shop");
    expect(verticalDef("courses").defaultFulfillment).toBe("digital");
    expect(isPhysicalShopVertical("courses")).toBe(false);
    expect(isCoursesVertical("courses")).toBe(true);
    expect(verticalDef("courses").suggestedModules).toEqual(["courses", "vip", "manager_chat"]);
  });
});
