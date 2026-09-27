import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SETTING_KEYS, settingsForRole, WRITABLE_SETTING_KEYS } from "./setting-keys";

// Та же схема, что у saveSettingsFn.
const save = z.record(z.enum(WRITABLE_SETTING_KEYS), z.string().max(4000));

describe("настройки магазина: что продавец может записать и увидеть", () => {
  it("счётчики расходов платформы продавец не сбрасывает, но видит", () => {
    for (const k of [
      "receipt_ocr_usage",
      "consultant_usage",
      "smart_search_daily_count",
      "smart_search_daily_spend",
      "smart_search_lifetime_spend",
      "smart_search_last_error",
      "consultant_last_error",
    ]) {
      expect(save.safeParse({ [k]: "{}" }).success, k).toBe(false);
      expect(SETTING_KEYS as readonly string[]).toContain(k);
    }
  });

  it("обычные настройки записываются как раньше", () => {
    expect(save.safeParse({ shop_name: "Магазин", robokassa_pass1: "x" }).success).toBe(true);
  });

  it("пароли Robokassa видит только владелец", () => {
    const s = {
      shop_name: "М",
      robokassa_login: "shop",
      robokassa_pass1: "p1",
      robokassa_pass2_test: "p2",
    };
    expect(settingsForRole(s, "owner")).toEqual(s);
    for (const role of ["manager", "viewer"] as const) {
      const r = settingsForRole(s, role);
      expect(r).toEqual({ shop_name: "М", robokassa_login: "shop" });
    }
    expect(s.robokassa_pass1).toBe("p1");
  });
});
