import { describe, expect, it } from "vitest";
import {
  PAY_FAILED_NEAR_MS,
  failedNearPhoto,
  isBareNumber,
  isOldOrder,
  isYes,
  resendOldConfirmOn,
  unpaidNumberOn,
} from "./pay-chat";

describe("оплата и чеки в переписке: чистые правила", () => {
  it("голый номер — «3», «003», «#482»; слова и телефон — нет", () => {
    for (const t of ["3", "003", " #482 ", "1415"]) expect(isBareNumber(t), t).toBe(true);
    for (const t of ["3 штуки", "87770637152", "№3", "", "хочу 482"])
      expect(isBareNumber(t), t).toBe(false);
  });

  it("«да» на четырёх языках; «да, а когда?» и «нет» — не согласие", () => {
    for (const t of ["да", "Да!", "да, пожалуйста", "Иә", "ha", "Yes", "ок", "+"])
      expect(isYes(t), t).toBe(true);
    for (const t of ["нет", "да, а когда придёт?", "мне другое", "Части речи"])
      expect(isYes(t), t).toBe(false);
  });

  it("старый заказ — старше 14 дней", () => {
    const now = Date.parse("2026-10-12T07:35:00Z");
    expect(isOldOrder("2026-09-10T10:55:57Z", now)).toBe(true);
    expect(isOldOrder("2026-10-01T10:00:00Z", now)).toBe(false);
    expect(isOldOrder("не дата", now)).toBe(false);
  });

  it("«не проходит» относится к фото, если написано не раньше чем за 5 секунд до него", () => {
    const photo = Date.parse("2026-10-11T18:27:06Z");
    // kopats23: фото 18:27:06, «Не проходит» 18:27:09 — к этому фото.
    expect(failedNearPhoto("2026-10-11T18:27:09Z", photo)).toBe(true);
    expect(failedNearPhoto(new Date(photo - PAY_FAILED_NEAR_MS).toISOString(), photo)).toBe(true);
    // Через минуту после «не проходит» — новая попытка, фото — чек.
    expect(failedNearPhoto("2026-10-11T18:26:00Z", photo)).toBe(false);
    expect(failedNearPhoto(null, photo)).toBe(false);
  });

  it("переключатели по умолчанию включены, «false» выключает", () => {
    expect(unpaidNumberOn(null)).toBe(true);
    expect(unpaidNumberOn("false")).toBe(false);
    expect(resendOldConfirmOn(undefined)).toBe(true);
    expect(resendOldConfirmOn(" false ")).toBe(false);
  });
});
