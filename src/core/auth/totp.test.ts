import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hashBackupCode,
  hotp,
  newBackupCodes,
  newTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  useBackupCode,
  verifyTotp,
} from "./totp";

// RFC 6238, приложение B: ключ SHA1 — ASCII «12345678901234567890».
const RFC_KEY = Buffer.from("12345678901234567890");
const RFC_SECRET = base32Encode(RFC_KEY);

describe("одноразовые коды (TOTP)", () => {
  it("совпадают с эталонными значениями RFC 6238", () => {
    // Восьмизначные коды из RFC; шестизначный — последние 6 цифр.
    expect(hotp(RFC_KEY, totpStep(59_000), 8)).toBe("94287082");
    expect(hotp(RFC_KEY, totpStep(1_111_111_109_000), 8)).toBe("07081804");
    expect(hotp(RFC_KEY, totpStep(1_234_567_890_000), 8)).toBe("89005924");
    expect(hotp(RFC_KEY, totpStep(2_000_000_000_000), 8)).toBe("69279037");
    expect(totpCode(RFC_SECRET, 59_000)).toBe("287082");
  });

  it("base32 туда и обратно, ключ приложения читается без пробелов и регистра", () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(base32Decode("gezd gnbv").toString()).toBe("12345");
  });

  it("принимает код текущего шага и соседних, но не дальше", () => {
    const now = 1_700_000_000_000;
    const code = (dStep: number) => totpCode(RFC_SECRET, now + dStep * 30_000);
    expect(verifyTotp(RFC_SECRET, code(0), now)).toBe(totpStep(now));
    expect(verifyTotp(RFC_SECRET, code(-1), now)).toBe(totpStep(now) - 1);
    expect(verifyTotp(RFC_SECRET, code(1), now)).toBe(totpStep(now) + 1);
    expect(verifyTotp(RFC_SECRET, code(-3), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", now)).toBeNull();
    expect(
      verifyTotp(RFC_SECRET, ` ${code(0).slice(0, 3)} ${code(0).slice(3)} `, now),
    ).not.toBeNull();
  });

  it("однажды принятый код второй раз не пускает", () => {
    const now = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, now)!;
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    // Следующий код после использованного — проходит.
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, now + 30_000), now, step)).toBe(step + 1);
  });

  it("ссылка для приложения несёт ключ, издателя и логин", () => {
    const uri = otpauthUri("ABC", "admin_a");
    expect(uri.startsWith("otpauth://totp/FrogFlow%3Aadmin_a?")).toBe(true);
    const q = new URL(uri).searchParams;
    expect(q.get("secret")).toBe("ABC");
    expect(q.get("issuer")).toBe("FrogFlow");
    expect(q.get("digits")).toBe("6");
    expect(q.get("period")).toBe("30");
  });
});

describe("резервные коды", () => {
  it("десять разных кодов вида XXXX-XXXX без похожих символов", () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("каждый код срабатывает один раз; регистр, пробелы и дефис не важны", () => {
    const codes = newBackupCodes(3);
    const hashes = codes.map(hashBackupCode);
    const left = useBackupCode(hashes, ` ${codes[1]!.toLowerCase().replace("-", " ")} `);
    expect(left).toEqual([hashes[0], hashes[2]]);
    expect(useBackupCode(left!, codes[1]!)).toBeNull();
    // Битая запись не той длины — не совпадение, а не исключение (500).
    expect(useBackupCode(["abc", ...hashes], "0000-0000")).toBeNull();
    expect(useBackupCode(["abc", ...hashes], codes[2]!)).toHaveLength(hashes.length);
    expect(useBackupCode(hashes, "AAAA-AAAA")).toBeNull();
  });
});
