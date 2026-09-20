import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptedSecret, secretFingerprint } from "./vault";

const KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const KEY_B64 = Buffer.from(KEY_HEX, "hex").toString("base64");

describe("secrets vault", () => {
  it("шифрует и расшифровывает, каждый раз с новым iv", () => {
    const a = encryptSecret("123456:ABC-DEF", KEY_HEX);
    const b = encryptSecret("123456:ABC-DEF", KEY_HEX);
    expect(a).not.toBe(b);
    expect(a.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(a, KEY_HEX)).toBe("123456:ABC-DEF");
    expect(decryptSecret(b, KEY_B64)).toBe("123456:ABC-DEF");
  });

  it("не расшифровывает чужим ключом и повреждённый текст", () => {
    const enc = encryptSecret("token", KEY_HEX);
    expect(() => decryptSecret(enc, "f".repeat(64))).toThrow();
    expect(() => decryptSecret(enc.slice(0, -2) + "zz", KEY_HEX)).toThrow();
    expect(() => decryptSecret("123456:plain", KEY_HEX)).toThrow(/не зашифрован/);
  });

  it("отличает зашифрованное от открытого", () => {
    expect(isEncryptedSecret("enc:v1:a:b:c")).toBe(true);
    expect(isEncryptedSecret("123:abc")).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });

  it("отпечаток не раскрывает секрет", () => {
    expect(secretFingerprint("token")).toHaveLength(8);
    expect(secretFingerprint("token")).not.toContain("token");
    expect(secretFingerprint(null)).toBe("—");
  });
});
