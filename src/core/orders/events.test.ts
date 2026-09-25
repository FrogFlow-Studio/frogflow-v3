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
    expect(
      describeOrderEvent({
        kind: "delivery_failed",
        actor: "bot",
        payload: { failed: 1, total: 3 },
      }).text,
    ).toBe("Выдача не завершена: не удалось 1 из 3");
  });
});
