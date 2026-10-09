/** Выбор страны и зоны доставки. */

export type CountryOption = { code: string; name: string };

/**
 * Страна: порядковый номер из списка, название целиком или с начала (флаг
 * отбрасывается), код. Список у каждого клиента свой — из payment_methods.
 */
export function matchCountry(text: string, options: CountryOption[]): CountryOption | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) return options[Number(ordinal[1]) - 1] ?? null;
  const strip = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const needle = strip(raw);
  if (!needle) return null;
  for (const option of options) {
    if (option.code.toLowerCase() === needle) return option;
    const name = strip(option.name);
    if (!name) continue;
    if (name === needle) return option;
    if (needle.length >= 4 && name.startsWith(needle)) return option;
  }
  return null;
}

export type ZoneOption = { id: string; name: string };

/** Зона доставки: порядковый номер или название целиком/с начала. */
export function matchZone(text: string, options: ZoneOption[]): ZoneOption | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) return options[Number(ordinal[1]) - 1] ?? null;
  const strip = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const needle = strip(raw);
  if (!needle) return null;
  for (const option of options) {
    const name = strip(option.name);
    if (!name) continue;
    if (name === needle) return option;
    if (needle.length >= 3 && name.startsWith(needle)) return option;
  }
  return null;
}
