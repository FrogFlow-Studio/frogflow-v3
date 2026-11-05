import { describe, expect, it } from "vitest";
import { cleanChecker } from "./proof-checker";
import { proofEtaText } from "./proof-eta";

const TZ = "Asia/Bishkek"; // UTC+6
const at = (utcHour: number) => new Date(Date.UTC(2026, 10, 3, utcHour, 15));
const hours = { open: 10, close: 20 };

describe("чек получен — кто и когда проверит", () => {
  it("в рабочие часы — «сегодня до 20:00», с именем проверяющего", () => {
    expect(
      proofEtaText("ru", { no: 7, checker: "Айс", workHours: hours, now: at(6), timezone: TZ }),
    ).toBe(
      "✅ Чек по заказу #7 получен. Айс проверит его сегодня до 20:00. Как только чек проверят, бот сразу напишет сюда — ничего больше делать не нужно.",
    );
  });

  it("рано утром — «сегодня после 10:00», поздно вечером — «завтра после 10:00»", () => {
    expect(
      proofEtaText("ru", { no: 7, checker: "Айс", workHours: hours, now: at(1), timezone: TZ }),
    ).toContain("Айс проверит его сегодня после 10:00.");
    expect(
      proofEtaText("ru", { no: 7, checker: "Айс", workHours: hours, now: at(16), timezone: TZ }),
    ).toContain("Айс проверит его завтра после 10:00.");
  });

  it("часов работы нет — без времени; имени нет — «Продавец»", () => {
    expect(proofEtaText("ru", { no: 3, workHours: null, now: at(6), timezone: TZ })).toContain(
      "Продавец проверит его и подтвердит заказ.",
    );
  });

  it("все четыре языка дают текст с номером заказа", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(
        proofEtaText(l, { no: 12, checker: "Ais", workHours: hours, now: at(6), timezone: TZ }),
      ).toMatch(/#12[\s\S]*20:00/);
  });

  it("имя проверяющего без разметки и не длиннее 40 знаков", () => {
    expect(cleanChecker("  <b>Айс</b> ")).toBe("bАйс/b");
    expect(cleanChecker("А".repeat(60))).toHaveLength(40);
    expect(cleanChecker("   ")).toBeNull();
    expect(cleanChecker(5)).toBeNull();
  });
});
