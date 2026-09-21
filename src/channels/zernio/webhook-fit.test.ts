import { describe, expect, it } from "vitest";
import { describeWebhookFit, isOtherStoreWebhook } from "./webhook-fit";

const expected = "https://app.frogflow.kz/api/zernio/webhook";

describe("describeWebhookFit", () => {
  it("missing — записи нет", () => {
    expect(describeWebhookFit([], expected)).toEqual({ fit: "missing" });
  });
  it("stale — чужой хост, выключена или не слушает входящие", () => {
    const other = {
      name: "Store Webhook",
      url: "https://old.example/api/public/zernio/webhook",
      events: ["message.received"],
      isActive: true,
    };
    expect(describeWebhookFit([other], expected)).toEqual({ fit: "stale", current: other });
    expect(
      describeWebhookFit(
        [{ name: "Store Webhook", url: expected, events: ["message.received"], isActive: false }],
        expected,
      ).fit,
    ).toBe("stale");
    expect(
      describeWebhookFit(
        [
          {
            name: "Instagram Store Webhook",
            url: expected,
            events: ["account.disconnected"],
            isActive: true,
          },
        ],
        expected,
      ).fit,
    ).toBe("stale");
  });
  it("ok — этот деплой уже подписан на входящие", () => {
    const current = {
      name: "FrogFlow Store Webhook",
      url: expected,
      events: ["message.received", "comment.received", "account.disconnected"],
      isActive: true,
    };
    expect(describeWebhookFit([current], expected)).toEqual({ fit: "ok", current });
  });
});

describe("isOtherStoreWebhook", () => {
  it("узнаёт чужой деплой FrogFlow (v1 или другой v2) и не считает чужим свой или посторонний URL", () => {
    expect(
      isOtherStoreWebhook("https://client-v1.vercel.app/api/public/zernio/webhook", expected),
    ).toBe(true);
    expect(isOtherStoreWebhook("https://other.frogflow.kz/api/zernio/webhook", expected)).toBe(
      true,
    );
    expect(isOtherStoreWebhook(expected, expected)).toBe(false);
    expect(isOtherStoreWebhook("https://foo.example/hook", expected)).toBe(false);
    expect(isOtherStoreWebhook(undefined, expected)).toBe(false);
    expect(isOtherStoreWebhook("not a url", expected)).toBe(false);
  });
});
