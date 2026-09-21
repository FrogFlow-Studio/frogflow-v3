import { describe, expect, it } from "vitest";
import { normalizeZernioBaseUrl } from "./base-url";

describe("normalizeZernioBaseUrl", () => {
  it("пусто — адрес API по умолчанию", () => {
    expect(normalizeZernioBaseUrl(undefined)).toBe("https://zernio.com/api/v1");
    expect(normalizeZernioBaseUrl("  ")).toBe("https://zernio.com/api/v1");
  });
  it("сайт без пути достраивается до API", () => {
    expect(normalizeZernioBaseUrl("https://zernio.com")).toBe("https://zernio.com/api/v1");
    expect(normalizeZernioBaseUrl("https://zernio.com/")).toBe("https://zernio.com/api/v1");
  });
  it("свой адрес берётся как есть, без завершающего слэша", () => {
    expect(normalizeZernioBaseUrl("https://api.example.com/v2/")).toBe(
      "https://api.example.com/v2",
    );
  });
});
