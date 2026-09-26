/**
 * Номер Kaspi владельца в виде 7XXXXXXXXXX: Kaspi — казахстанские мобильные
 * (+7 7xx…). Принимает +7, 8 и 7 в начале, пробелы, скобки, дефисы; всё
 * остальное — null, чтобы счёт не ушёл на чужой номер из-за опечатки.
 */
export function normalizeKaspiPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[\s()+-]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const ten =
    digits.length === 11 && (digits[0] === "7" || digits[0] === "8")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  return ten && ten[0] === "7" ? `7${ten}` : null;
}
