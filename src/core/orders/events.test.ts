import { describe, expect, it } from "vitest";
import { describeOrderEvent } from "./events";

describe("describeOrderEvent", () => {
  it("каждое событие — строка таймлайна с тоном; продавец подписан", () => {
    expect(
      describeOrderEvent({ kind: "placed", actor: "bot", payload: { platform: "telegram" } }),
    ).toEqual({
      text: "Заказ создан · telegram",
      tone: "neutral",
    });
    expect(
      describeOrderEvent({ kind: "item_sent", actor: "bot", payload: { name: "Курс", lang: "kk" } })
        .text,
    ).toBe("Выдано: Курс (kk)");
    expect(
      describeOrderEvent({
        kind: "item_failed",
        actor: "bot",
        payload: { name: "Курс", reason: "нет файлов" },
      }),
    ).toEqual({ text: "Не выдалось: Курс — нет файлов", tone: "danger" });
    expect(describeOrderEvent({ kind: "rejected", actor: "admin", payload: {} }).text).toBe(
      "Заказ отклонён (продавец)",
    );
    expect(describeOrderEvent({ kind: "rejected", actor: "admin:masha", payload: {} }).text).toBe(
      "Заказ отклонён (masha)",
    );
    expect(
      describeOrderEvent({
        kind: "delivery_failed",
        actor: "bot",
        payload: { failed: 1, total: 3 },
      }).text,
    ).toBe("Выдача не завершена: не удалось 1 из 3");
  });

  it("ручной заказ, внесённая оплата и смена получения видны в истории", () => {
    expect(
      describeOrderEvent({ kind: "placed", actor: "admin:masha", payload: { platform: "manual" } })
        .text,
    ).toBe("Заказ заведён вручную (masha)");
    expect(
      describeOrderEvent({
        kind: "payment",
        actor: "admin",
        payload: { amount: 5000, currency: "KZT" },
      }),
    ).toEqual({ text: "Внесено 5000 KZT (продавец)", tone: "ok" });
    expect(
      describeOrderEvent({
        kind: "payment",
        actor: "admin",
        payload: { amount: 3000, source: "deposit" },
      }).text,
    ).toBe("Внесено 3000 (задаток по чеку) (продавец)");
    expect(
      describeOrderEvent({ kind: "fulfillment_changed", actor: "admin", payload: {} }).text,
    ).toBe("Получение изменено (продавец)");
  });
});
