import { isLocale, localeNames, SUPPORTED_LOCALES, type Locale } from "@/core/i18n/locale";

/** Номера товаров, телефонов и выбор по порядку. */

const normalizeNumber = (raw: string) => {
  const normalized = raw.replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
};

/**
 * Номер телефона, а не коды товаров: «87770637152», «8 (777) 063-71-52»,
 * «+7 777 063 71 52», «+998 90 123 45 67». Код товара — до 5 цифр, поэтому
 * одна цифровая строка в 10–15 знаков кодом быть не может; с пробелами номер
 * узнаём по «+» или по форме «7/8 + 10 цифр» (так не спутать с «130 134 136 138»).
 * Список через запятую или «и» — это коды. Возвращает цифры (без «+»).
 */
export function extractPhoneDigits(text: string): string | null {
  const raw = text.trim();
  if (!/^\+?[\d\s().-]{9,24}$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (/\d{6,}/.test(raw) || raw.startsWith("+")) return digits;
  const kz = digits.length === 11 && /^[78]/.test(digits);
  const short = digits.length === 10 && digits.startsWith("7");
  return kz || short ? digits : null;
}

/** «018», «18», «№18», «18.» — номер товара из поста; null — обычный текст. */
export function extractProductNumber(text: string): string | null {
  const cleaned = text.trim().replace(/^[№#]\s*/, "");
  const match = cleaned.match(/^(\d{1,5})\s*[.)]?$/);
  return match ? normalizeNumber(match[1]!) : null;
}

/**
 * Несколько номеров одним сообщением: «2 4 7», «2, 4, 7», «2\n4\n7», «#130 #134».
 * Покупатели так выбирают сразу несколько товаров из списка (Educational
 * Bot, 29.09). Одиночный номер — не список (его разбирает extractProductNumber).
 * Повторы убираются, больше 10 номеров не берём.
 */
export function extractNumberList(text: string): string[] | null {
  const raw = text.trim();
  // Больше пяти цифр подряд — не номер товара (телефон, счёт), резать на куски нельзя.
  if (/\d{6,}/.test(raw) || extractPhoneDigits(raw)) return null;
  if (!/^[№#]?\s*\d{1,5}(?:\s*[.)]?\s*(?:[,;+и]|and)?\s*[№#]?\s*\d{1,5})+\s*[.)]?$/iu.test(raw))
    return null;
  const numbers = Array.from(new Set((raw.match(/\d{1,5}/g) ?? []).map(normalizeNumber)));
  return numbers.length >= 2 ? numbers.slice(0, 10) : null;
}

/**
 * Код материала с решёткой внутри фразы: «Здравствуйте! Хочу материал #245».
 * Так продавец подписывает приветствие в рекламе «Написать в WhatsApp/Direct»:
 * без кода бот не знает, с какого ролика пришёл человек (Дидактика, 29.09).
 * Ровно один код — иначе это не выбор, а вопрос.
 */
export function taggedProductNumber(text: string): string | null {
  const codes = Array.from(
    new Set([...text.matchAll(/[#№]\s?(\d{1,5})(?!\d)/g)].map((m) => normalizeNumber(m[1]!))),
  );
  return codes.length === 1 ? codes[0]! : null;
}

/**
 * Буквенный код с решёткой: «Хочу приобрести #кпп». Продавец вписывает
 * «кпп» в ключевые слова карточки, покупатель пишет его с решёткой — без
 * решётки слово остаётся обычной репликой (AATeach, 07.10). Ровно одна метка
 * из букв (цифры после первой буквы можно); числовой код — taggedProductNumber.
 */
export function taggedKeyword(text: string): string | null {
  const tags = Array.from(
    new Set(
      [...text.matchAll(/#(\p{L}[\p{L}\p{N}_-]{0,29})(?![\p{L}\p{N}_-])/gu)].map((m) =>
        m[1]!.toLowerCase(),
      ),
    ),
  );
  return tags.length === 1 ? tags[0]! : null;
}

/** Номер из названия: «018. Набор …», «236) Пазлы …», «081 | Дни недели», «165 Календари». */
export function productNumberFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.trim().match(/^(\d{1,5})(?:\s*[.)|]|\s+\S)/);
  return match ? normalizeNumber(match[1]!) : null;
}

/** Номер из ключевых слов — только целым первым словом: «018, пазлы, …». */
export function productNumberFromKeywords(keywords: string | null | undefined): string | null {
  if (!keywords) return null;
  const match = keywords.trim().match(/^(\d{1,5})\s*,/);
  return match ? normalizeNumber(match[1]!) : null;
}

/** «Убрать 018» — передумать по одной позиции, а не выкидывать всю корзину. */
export function parseRemoveCommand(text: string): string | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(?:убрать|убери|удали|удалить|минус|-)\s*[№#]?\s*(\d{1,5})\s*[.)]?$/);
  return match ? normalizeNumber(match[1]!) : null;
}

/** Какую позицию убрать: по номеру материала, потом по месту в показанном списке. */
export function pickCartLineToRemove(number: string, names: string[]): number | null {
  const byNumber = names.findIndex((name) => productNumberFromName(name) === number);
  if (byNumber >= 0) return byNumber;
  const position = Number(number);
  if (Number.isInteger(position) && position >= 1 && position <= names.length) return position - 1;
  return null;
}

/** Порядковый номер из показанного списка: «2», «2.», «2)». */
export function matchOrdinal(text: string, size: number): number | null {
  const m = text.trim().match(/^(\d{1,2})\s*[.)]?$/);
  if (!m) return null;
  const index = Number(m[1]) - 1;
  return index >= 0 && index < size ? index : null;
}

/**
 * Язык на первом шаге: порядковый номер (порядок SUPPORTED_LOCALES), код
 * («ru») или родное название целиком/с начала («Рус», «English»). Кнопок
 * у Instagram три, языков четыре — поэтому список текстом.
 */
export function matchLocalePick(text: string): Locale | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;
  const ordinal = raw.match(/^(\d{1,2})\s*[.)]?$/);
  if (ordinal) return SUPPORTED_LOCALES[Number(ordinal[1]) - 1] ?? null;
  const strip = (value: string) => value.toLowerCase().replace(/[^\p{L}]+/gu, "");
  const needle = strip(raw);
  if (!needle) return null;
  if (isLocale(needle)) return needle;
  for (const locale of SUPPORTED_LOCALES) {
    const name = strip(localeNames[locale]);
    if (name === needle) return locale;
    if (needle.length >= 3 && name.startsWith(needle)) return locale;
  }
  return null;
}
