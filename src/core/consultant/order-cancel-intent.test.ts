import { describe, expect, it } from "vitest";
import {
  cancellationIntentMatchesOrder,
  isCancellationOrderNumberReply,
  isExplicitOrderCancellation,
} from "./order-cancel-intent";

describe("order-cancel-intent", () => {
  it.each([
    "Отмени заказ №270",
    "Пожалуйста, отмените 270",
    "Cancel order #270",
    "Bekor qiling order 270",
  ])("распознаёт явную просьбу: %s", (text) =>
    expect(isExplicitOrderCancellation(text)).toBe(true),
  );

  it.each(["Как отменить заказ 270?", "Можно ли отменить 270?", "Can I cancel order 270?"])(
    "не считает вопрос о правилах разрешением на отмену: %s",
    (text) => expect(isExplicitOrderCancellation(text)).toBe(false),
  );

  it("разрешает отмену, когда покупатель назвал номер в той же просьбе", () => {
    expect(cancellationIntentMatchesOrder([], "Отмени заказ 270", 270)).toBe(true);
  });

  it("разрешает номер в ответ на уточнение после явной просьбы отменить", () => {
    expect(
      cancellationIntentMatchesOrder(
        [
          { role: "customer", text: "Отмени" },
          { role: "assistant", text: "Какой заказ отменить?" },
        ],
        "270",
        270,
      ),
    ).toBe(true);
  });

  it("узнаёт число как ответ на вопрос AI о номере отменяемого заказа", () => {
    expect(
      isCancellationOrderNumberReply(
        [
          { role: "customer", text: "Отмени" },
          { role: "assistant", text: "Какой номер заказа отменить?" },
        ],
        "270",
      ),
    ).toBe(true);
  });

  it("не перехватывает обычное число или число после другого вопроса", () => {
    expect(isCancellationOrderNumberReply([], "270")).toBe(false);
    expect(
      isCancellationOrderNumberReply(
        [
          { role: "customer", text: "Отмени" },
          { role: "assistant", text: "Как я могу помочь?" },
        ],
        "270",
      ),
    ).toBe(false);
  });

  it("не принимает другой номер и не использует устаревшую просьбу, если номер не назван", () => {
    expect(
      cancellationIntentMatchesOrder([{ role: "customer", text: "Отмени" }], "2700", 270),
    ).toBe(false);
    expect(cancellationIntentMatchesOrder([], "270", 270)).toBe(false);
  });
});
