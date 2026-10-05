import { describe, expect, it } from "vitest";
import { NEW_VIEW_DEFAULT, NEW_VIEW_KEY, newViewOn } from "./new-view";
import { SETTING_KEYS, WRITABLE_SETTING_KEYS } from "@/app/admin/setting-keys";

describe("переключатель «новый вид»", () => {
  it("по умолчанию выключен: нет значения и мусор — старый вид", () => {
    expect(NEW_VIEW_DEFAULT).toBe(false);
    for (const v of [null, undefined, "", "1", "yes"]) expect(newViewOn(v)).toBe(false);
  });
  it('"true" включает, "false" выключает', () => {
    expect(newViewOn("true")).toBe(true);
    expect(newViewOn("false")).toBe(false);
  });
  it("ключ сохраняется и читается обратно из настроек продавца", () => {
    expect(SETTING_KEYS).toContain(NEW_VIEW_KEY);
    expect(WRITABLE_SETTING_KEYS).toContain(NEW_VIEW_KEY);
  });
});
