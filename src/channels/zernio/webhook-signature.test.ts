import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const { verifyZernioSignature } = await import("@/routes/api/zernio/webhook");

/** Подпись вебхука Zernio: HMAC-SHA256 от сырого тела, hex (опись v1: tests/zernio-webhook.test.ts). */
describe("подпись вебхука Zernio", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt-1", event: "message.received", text: "Привет" });
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts an HMAC-SHA256 signature for the untouched raw body", () => {
    expect(verifyZernioSignature(body, signature, secret)).toBe(true);
  });

  it("rejects missing credentials, altered bodies and altered signatures", () => {
    expect(verifyZernioSignature(body, null, secret)).toBe(false);
    expect(verifyZernioSignature(body, signature, undefined)).toBe(false);
    expect(verifyZernioSignature(body, signature, "")).toBe(false);
    expect(verifyZernioSignature(`${body} `, signature, secret)).toBe(false);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    expect(verifyZernioSignature(body, flipped, secret)).toBe(false);
    expect(verifyZernioSignature(body, signature.toUpperCase(), secret)).toBe(false);
    expect(verifyZernioSignature(body, signature.slice(0, 10), secret)).toBe(false);
    expect(verifyZernioSignature(body, signature, "другой секрет")).toBe(false);
  });
});
