import { describe, expect, it } from "vitest";
import { ru, kk, en, uz } from "@/app/i18n/admin/settings";
import { CHECK_CODES } from "./bot-check";

describe("Проверить бота: тексты", () => {
  it("у каждого кода пункта есть текст на всех четырёх языках", () => {
    const keys = [
      "settings.tg.checkBot",
      "settings.tg.repair",
      "settings.tg.checkOk",
      "settings.tg.skip.not_v2",
      "settings.tg.skip.no_token",
      "settings.tg.repairFailed.telegram",
      "settings.tg.repairFailed.unknown",
      "settings.tg.check.late",
      ...Object.entries(CHECK_CODES).flatMap(([k, codes]) =>
        codes.map((c) => `settings.tg.check.${k}.${c}`),
      ),
    ];
    for (const dict of [ru, kk, en, uz] as Array<Record<string, string>>)
      for (const k of keys) expect(dict[k], k).toBeTruthy();
  });
});
