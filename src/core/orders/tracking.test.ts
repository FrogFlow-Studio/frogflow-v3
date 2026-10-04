import { describe, expect, it } from "vitest";
import {
  latestTracking,
  normalizeTrackNumber,
  trackingFromText,
  trackingKey,
  trackingMessage,
} from "./tracking";

describe("трек-номер: формат и ссылка", () => {
  it("СДЭК — 10 цифр, ссылка на отслеживание", () => {
    expect(trackingFromText("1234 567 890")).toEqual({
      number: "1234567890",
      carrier: "cdek",
      url: "https://www.cdek.ru/ru/tracking?order_id=1234567890",
    });
  });
  it("Казпочта — формат UPU, ссылка на сайт", () => {
    expect(trackingFromText("rr123456789kz")).toMatchObject({
      number: "RR123456789KZ",
      carrier: "kazpost",
      url: "https://post.kz/",
    });
  });
  it("неизвестный формат — только номер; готовая https-ссылка — только ссылка", () => {
    expect(trackingFromText("AB-77-XYZ-99")).toEqual({
      number: "AB-77-XYZ-99",
      carrier: null,
      url: null,
    });
    expect(trackingFromText("https://go.yandex/track/abc")).toMatchObject({
      number: null,
      url: "https://go.yandex/track/abc",
    });
  });
  it("мусор, http и javascript: — не трек", () => {
    for (const t of ["привет", "123", "http://x.kz/1", "javascript:alert(1)", "ABCDEFGH", ""])
      expect(trackingFromText(t)).toBeNull();
    expect(normalizeTrackNumber("12 34")).toBeNull();
  });
  it("ключ «один раз»: тот же номер — тот же ключ, другой — другой", () => {
    const a = trackingFromText("1234567890")!;
    expect(trackingKey(a)).toBe(trackingKey(trackingFromText("1234 567 890")!));
    expect(trackingKey(a)).not.toBe(trackingKey(trackingFromText("1234567891")!));
  });
  it("сообщение покупателю на 4 языках содержит номер", () => {
    const t = trackingFromText("1234567890")!;
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(trackingMessage(l, 7, t)).toContain("1234567890");
  });
  it("последний трек журнала", () => {
    expect(
      latestTracking([
        { kind: "tracking", payload: { number: "A1B2C3D4", url: null, carrier: null } },
        { kind: "status", payload: {} },
        { kind: "tracking", payload: { number: "1234567890", url: "http://bad", carrier: "cdek" } },
      ]),
    ).toEqual({ number: "1234567890", url: null, carrier: "cdek" });
  });
});
