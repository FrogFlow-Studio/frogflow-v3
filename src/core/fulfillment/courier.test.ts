import { describe, expect, it } from "vitest";
import { cleanPhone, courierMessage, courierState, safeTrackUrl } from "./courier";

const ev = (payload: Record<string, string>, at = "2026-09-28T10:00:00Z") => ({
  kind: "courier" as const,
  at,
  payload,
});

describe("курьер по заказу", () => {
  it("действует последняя передача курьеру; чужие события и службы не в счёт", () => {
    expect(courierState([])).toBeNull();
    const s = courierState([
      ev({ provider: "yandex", trackUrl: "https://dostavka.yandex.ru/route/1" }),
      { kind: "status", at: "2026-09-28T10:01:00Z", payload: {} },
      ev({ provider: "indrive", phone: "+7 700 000 00 00" }, "2026-09-28T11:00:00Z"),
      ev({ provider: "почта" }, "2026-09-28T12:00:00Z"),
    ]);
    expect(s).toEqual({
      provider: "indrive",
      trackUrl: null,
      phone: "+7 700 000 00 00",
      at: "2026-09-28T11:00:00Z",
    });
  });

  it("ссылка отслеживания — только https с доменом", () => {
    expect(safeTrackUrl(" https://go.yandex/route/abc ")).toBe("https://go.yandex/route/abc");
    expect(safeTrackUrl("http://go.yandex/route")).toBeNull();
    expect(safeTrackUrl("javascript:alert(1)")).toBeNull();
    expect(safeTrackUrl("https://localhost/x")).toBeNull();
    expect(safeTrackUrl("")).toBeNull();
  });

  it("телефон курьера — цифры и знаки номера", () => {
    expect(cleanPhone("+7 (700) 123-45-67")).toBe("+7 (700) 123-45-67");
    expect(cleanPhone("позвоните")).toBeNull();
    expect(cleanPhone("123")).toBeNull();
  });

  it("сообщение покупателю — служба, ссылка и телефон, без пустых строк", () => {
    expect(
      courierMessage(12, { provider: "yandex", trackUrl: "https://t.ya/1", phone: null }),
    ).toBe("🚚 Заказ #12 передан курьеру (Яндекс Доставка).\nСледить за доставкой: https://t.ya/1");
    expect(courierMessage(5, { provider: "own", trackUrl: null, phone: "+77001234567" })).toBe(
      "🚚 Заказ #5 передан курьеру (курьер магазина).\nТелефон курьера: +77001234567",
    );
  });
});
