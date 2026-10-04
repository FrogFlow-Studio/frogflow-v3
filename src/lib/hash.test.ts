import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash";
import { timingSafeSecretEqual } from "./safe-equal";

describe("sha256Hex", () => {
  it("совпадает с createHash и режет по длине", () => {
    const full = createHash("sha256").update("abc").digest("hex");
    expect(sha256Hex("abc")).toBe(full);
    expect(sha256Hex("abc", 12)).toBe(full.slice(0, 12));
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(full);
  });
});

describe("timingSafeSecretEqual", () => {
  it("равные — true, разные и разной длины — false", () => {
    expect(timingSafeSecretEqual("s3cret", "s3cret")).toBe(true);
    expect(timingSafeSecretEqual("s3cret", "s3creT")).toBe(false);
    expect(timingSafeSecretEqual("s3cret", "s3cret-longer")).toBe(false);
  });
});
