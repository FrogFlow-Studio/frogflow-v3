import { describe, expect, it } from "vitest";
import { attachmentNeedsZernioKey, normalizeZernioBaseUrl } from "./base-url";

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

describe("attachmentNeedsZernioKey", () => {
  it("ключ — только на хост API Zernio и только по https", () => {
    expect(attachmentNeedsZernioKey("https://zernio.com/api/v1/media/abc", undefined)).toBe(true);
    expect(
      attachmentNeedsZernioKey("https://api.example.io/files/x", "https://api.example.io/v1"),
    ).toBe(true);
    expect(attachmentNeedsZernioKey("http://zernio.com/api/v1/media/abc", undefined)).toBe(false);
  });

  it("чужие хосты и похожие имена ключ не получают", () => {
    for (const url of [
      "https://scontent.cdninstagram.com/v/t51/abc.jpg",
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      "https://zernio.com.evil.io/api/v1/media",
      "https://evil.io/?u=https://zernio.com/api/v1",
      "not a url",
    ])
      expect(attachmentNeedsZernioKey(url, undefined), url).toBe(false);
  });
});
