import { describe, expect, it } from "vitest";
import {
  firstTooLongSetting,
  LEGAL_TEXT_MAX,
  SETTING_VALUE_MAX,
  settingValueMax,
} from "./setting-keys";

describe("пределы длины настроек", () => {
  it("оферта на 100 000 символов проходит, обычная настройка длиннее 4000 — нет", () => {
    expect(LEGAL_TEXT_MAX).toBeGreaterThanOrEqual(100_000);
    expect(firstTooLongSetting({ legal_offer: "а".repeat(100_000) })).toBeNull();
    expect(firstTooLongSetting({ vip_welcome_message: "а".repeat(SETTING_VALUE_MAX + 1) })).toEqual(
      { key: "vip_welcome_message", length: SETTING_VALUE_MAX + 1, max: SETTING_VALUE_MAX },
    );
  });

  it("слишком длинный юридический текст называет поле и предел", () => {
    const r = firstTooLongSetting({
      legal_about: "x",
      legal_privacy: "я".repeat(LEGAL_TEXT_MAX + 1),
    });
    expect(r).toEqual({ key: "legal_privacy", length: LEGAL_TEXT_MAX + 1, max: LEGAL_TEXT_MAX });
    expect(settingValueMax("legal_requisites")).toBe(LEGAL_TEXT_MAX);
  });
});
