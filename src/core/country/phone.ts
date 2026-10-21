/**
 * Определение страны по номеру телефона (в WhatsApp или из реквизитов покупателя).
 * Возвращает ISO 2-буквенный код страны (KZ, RU, KG, UZ, BY и др.) или null.
 */
export function countryFromPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  // Казахстан: +7 7xx, +7 6xx (11 цифр), либо 87xx (11 цифр)
  // Казахстанские мобильные операторы: 700..709, 747, 750, 751, 760..764, 771..778
  if (/^7[67]\d{9}$/.test(digits) || /^87[04567]\d{8}$/.test(digits)) {
    return "KZ";
  }

  // Россия: +7 9xx (мобильные РФ), +7 [0-58] (городские), 8 [0-589]
  // 77 и 76 проверены выше
  if (/^7[0-589]\d{9}$/.test(digits) || /^8[0-589]\d{9}$/.test(digits)) {
    return "RU";
  }

  // Кыргызстан: +996 (9 цифр абонента = 12 цифр)
  if (/^996\d{9}$/.test(digits)) {
    return "KG";
  }

  // Узбекистан: +998 (9 цифр абонента = 12 цифр)
  if (/^998\d{9}$/.test(digits)) {
    return "UZ";
  }

  // Беларусь: +375 (9 цифр абонента = 12 цифр)
  if (/^375\d{9}$/.test(digits)) {
    return "BY";
  }

  // Таджикистан: +992 (9 цифр = 12 цифр)
  if (/^992\d{9}$/.test(digits)) {
    return "TJ";
  }

  // Азербайджан: +994 (9 цифр = 12 цифр)
  if (/^994\d{9}$/.test(digits)) {
    return "AZ";
  }

  // Армения: +374 (8 цифр = 11 цифр)
  if (/^374\d{8}$/.test(digits)) {
    return "AM";
  }

  // Грузия: +995 (9 цифр = 12 цифр)
  if (/^995\d{9}$/.test(digits)) {
    return "GE";
  }

  // Украина: +380 (9 цифр = 12 цифр)
  if (/^380\d{9}$/.test(digits)) {
    return "UA";
  }

  // Молдова: +373 (8 цифр = 11 цифр)
  if (/^373\d{8}$/.test(digits)) {
    return "MD";
  }

  return null;
}
