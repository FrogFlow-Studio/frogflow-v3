/**
 * Проверка ответа модели перед отправкой покупателю (Спецификация, раздел 4).
 * Без второго вызова модели: правила в коде. Основа — проверка цен v3
 * (core/consultant/guard), расширенная: доставка, язык, длина, обещания,
 * чужие контакты, утечка устройства, кнопка, повтор.
 *
 * Отказ = код + короткое замечание для модели («цена 25 000 не из каталога»):
 * ядро даёт модели одну попытку исправить, потом — простой ответ без ИИ.
 */

export const CHECK_CODES = [
  "empty",
  "price_unknown",
  "shipping_unknown",
  "wrong_language",
  "too_long",
  "promise",
  "foreign_contact",
  "leak",
  "offer_mismatch",
  "repeat",
] as const;
export type CheckCode = (typeof CHECK_CODES)[number];

export type CheckFailure = { code: CheckCode; hint: string };

export type CheckLang = "ru" | "kk" | "en" | "uz";

export type CheckContext = {
  lang: CheckLang;
  /** Цены каталога для страны покупателя, в единицах валюты (2000, не 200000). */
  prices: number[];
  /** Прочие разрешённые числа: из анкеты, знаний, результатов инструментов этого хода. */
  allowedNumbers: number[];
  /** Тексты магазина (анкета, знания, карточки): обещание разрешено, если слово есть здесь. */
  shopText: string;
  /** Условия доставки дословно (числа рядом со словом «доставка» — только отсюда). */
  deliveryTerms: string;
  /** Строки, которые можно цитировать как есть (названия товаров): не мешают проверке языка. */
  quoted: string[];
  /** Контакты и ссылки, которые разрешено называть (из анкеты, карточек, инструментов). */
  allowedContacts: string[];
  /** Имена инструментов роли — не должны попасть в текст. */
  toolNames: string[];
  /** В этом ответе есть карточка с кнопкой «Купить». */
  offerShown: boolean;
  /** Последние ответы бота этому покупателю, новые последними. */
  recentReplies: string[];
  maxChars?: number;
};

export const DEFAULT_MAX_CHARS = 600;

const CURRENCY =
  /(₸|тг\.?|тенге|теңге|₽|руб\.?|рублей|рубля|\$|usd|долл|kzt|rub|сум|so['ʻ’]m|сом|€|eur|kgs|uzs)/iu;
const KAZAKH_LETTERS = /[әғқңөұүһі]/iu;

/** Призыв нажать кнопку на любом из 4 языков. */
export const BUY_CALL =
  /купит|кнопк|оформ|сатып ал|батырма|рәсімде|\bbuy\b|\btap\b|button|sotib ol|tugma|rasmiylashtir/iu;

const DELIVERY_WORD = /доставк|жеткіз|delivery|shipping|yetkaz/iu;

const PROMISE_WORDS: Array<[RegExp, string]> = [
  [/скидк/iu, "скидк"],
  [/бесплатн/iu, "бесплатн"],
  [/подар/iu, "подар"],
  [/гарант/iu, "гарант"],
  [/вернём деньги|вернем деньги|возврат денег/iu, "возврат денег"],
  [/жеңілдік/iu, "жеңілдік"],
  [/тегін/iu, "тегін"],
  [/discount/iu, "discount"],
  [/\bfree\b/iu, "free"],
  [/chegirma/iu, "chegirma"],
  [/bepul/iu, "bepul"],
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/gu, " ").trim();

type FoundNumber = { value: number; raw: string; index: number; money: boolean; phone: boolean };

/** Числа в тексте: «1 700», «2.500», «16 500 ₸»; телефон и год отмечаются отдельно. */
export function findNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  const re = /\+?\d(?:[\d\u00a0\u202f ]*\d)?(?:[.,]\d+)?/gu;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const index = m.index ?? 0;
    const digits = raw.replace(/\D/gu, "");
    const phone = raw.startsWith("+") || digits.length >= 10;
    let clean = raw.replace(/[\u00a0\u202f ]/gu, "");
    // «2.500» и «2,500» — тысячи; «0,5» — дробь.
    if (/^\d{1,3}([.,]\d{3})+$/u.test(clean)) clean = clean.replace(/[.,]/gu, "");
    else clean = clean.replace(",", ".");
    const value = Number(clean.replace(/^\+/u, ""));
    if (!Number.isFinite(value)) continue;
    const around = text.slice(Math.max(0, index - 6), index + raw.length + 8);
    const hasCurrency = CURRENCY.test(around);
    const year = !hasCurrency && value >= 2020 && value <= 2035 && digits.length === 4;
    out.push({
      value,
      raw,
      index,
      phone,
      money: !phone && !year && (hasCurrency || value >= 1000),
    });
  }
  return out;
}

/** Известные суммы: цены, суммы 2–3 цен, цена × 3 (месяц, три класса), плюс разрешённые числа. */
export function knownAmounts(prices: number[], allowed: number[]): Set<number> {
  const p = [...new Set(prices.filter((x) => x > 0))].slice(0, 60);
  const known = new Set<number>([...p, ...allowed]);
  for (let i = 0; i < p.length; i++) {
    known.add(p[i]! * 3);
    for (let j = i; j < p.length; j++) {
      known.add(p[i]! + p[j]!);
      for (let k = j; k < p.length; k++) known.add(p[i]! + p[j]! + p[k]!);
    }
  }
  return known;
}

function letterShares(text: string) {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (!letters.length) return { cyr: 0, lat: 0, n: 0 };
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  const lat = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return { cyr: cyr / letters.length, lat: lat / letters.length, n: letters.length };
}

function stripQuoted(text: string, quoted: string[]): string {
  let t = text;
  for (const q of [...quoted].sort((a, b) => b.length - a.length)) {
    if (q.trim().length >= 3) t = t.split(q).join(" ");
  }
  // Кавычки «…» и "…" — обычно название товара; почта и ссылки — не язык.
  return t
    .replace(/«[^»]{1,80}»|"[^"]{1,80}"/gu, " ")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+|https?:\/\/\S+|www\.\S+|t\.me\/\S+/giu, " ");
}

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((x) => x.trim())
    .filter(Boolean);

export function checkReply(text: string, ctx: CheckContext): CheckFailure | null {
  const t = text.trim();
  if (!t && !ctx.offerShown) return { code: "empty", hint: "ответ пустой" };

  // 7. Утечка устройства — раньше остальных: такой текст нельзя показывать вовсе.
  const leakTool = ctx.toolNames.find((n) => n.length >= 4 && t.includes(n));
  if (
    leakTool ||
    /инструмент|промпт|\bprompt\b|\bsystem\b|tool_use|\{\s*"/iu.test(t) ||
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(t)
  ) {
    return {
      code: "leak",
      hint: "в ответе служебный текст (имена инструментов, id, JSON) — пиши только покупателю",
    };
  }

  // 4. Длина.
  const max = ctx.maxChars ?? DEFAULT_MAX_CHARS;
  if (t.length > max) return { code: "too_long", hint: `ответ длиннее ${max} знаков — короче` };

  // 1. Деньги только известные.
  const known = knownAmounts(ctx.prices, ctx.allowedNumbers);
  const numbers = findNumbers(t);
  const unknownMoney = numbers.find((n) => n.money && !known.has(n.value));
  if (unknownMoney) {
    return {
      code: "price_unknown",
      hint: `сумма ${unknownMoney.raw.trim()} не из каталога и не из условий магазина — назови цену из инструмента`,
    };
  }

  // 2. Доставка только из анкеты.
  const deliveryNumbers = new Set(findNumbers(ctx.deliveryTerms).map((n) => n.value));
  for (const s of sentences(t)) {
    if (!DELIVERY_WORD.test(s)) continue;
    const bad = findNumbers(s).find((n) => !n.phone && !deliveryNumbers.has(n.value));
    if (bad) {
      return {
        code: "shipping_unknown",
        hint: `число ${bad.raw.trim()} про доставку не из условий доставки магазина`,
      };
    }
  }

  // 3. Язык покупателя (названия товаров и цитаты не считаются).
  const body = stripQuoted(t, ctx.quoted);
  const sh = letterShares(body);
  if (sh.n >= 12) {
    const wrong =
      (ctx.lang === "kk" && t.length > 40 && !KAZAKH_LETTERS.test(body)) ||
      (ctx.lang === "en" && sh.cyr >= 0.2) ||
      (ctx.lang === "uz" && sh.lat <= 0.5) ||
      (ctx.lang === "ru" && (sh.cyr <= 0.5 || KAZAKH_LETTERS.test(body)));
    if (wrong) {
      const name = { ru: "русском", kk: "казахском", en: "английском", uz: "узбекском (латиница)" };
      return { code: "wrong_language", hint: `ответ должен быть на ${name[ctx.lang]} языке` };
    }
  }

  // 5. Без обещаний, которых нет в текстах магазина.
  const shop = ctx.shopText.toLowerCase();
  for (const [re, stem] of PROMISE_WORDS) {
    if (re.test(t) && !re.test(shop)) {
      return {
        code: "promise",
        hint: `«${stem}…» — этого нет в условиях магазина, не обещай; передай продавцу, если просят`,
      };
    }
  }

  // 6. Чужие контакты и ссылки.
  const allowed = ctx.allowedContacts.map(norm);
  const contacts = [
    ...(t.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/gu) ?? []),
    ...(t.match(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/giu) ?? []),
    ...numbers.filter((n) => n.phone).map((n) => n.raw.trim()),
  ];
  const digitsOf = (s: string) => s.replace(/\D/gu, "");
  const foreign = contacts.find((c) => {
    const nc = norm(c).replace(/[).,!?»]+$/u, "");
    const dc = digitsOf(c);
    return !allowed.some(
      (a) => a.includes(nc) || nc.startsWith(a) || (dc.length >= 10 && digitsOf(a).includes(dc)),
    );
  });
  if (foreign) {
    return {
      code: "foreign_contact",
      hint: `контакт или ссылка «${foreign}» не из анкеты магазина — не называй`,
    };
  }

  // 8. Кнопка есть, если обещана; с кнопкой — без вопроса в конце.
  if (!ctx.offerShown && BUY_CALL.test(t) && /нажм|жмит|басың|tap|bos/iu.test(t)) {
    return {
      code: "offer_mismatch",
      hint: "зовёшь нажать «Купить», а кнопки нет — сначала покажи предложение инструментом",
    };
  }
  if (ctx.offerShown && /\?\s*\p{Extended_Pictographic}*\s*$/u.test(t)) {
    return {
      code: "offer_mismatch",
      hint: "под ответом кнопка — не заканчивай вопросом, кнопка и есть следующий шаг",
    };
  }

  // 9. Не повтор одного из 3 последних ответов.
  const n = norm(t);
  if (n && ctx.recentReplies.slice(-3).some((r) => norm(r) === n)) {
    return { code: "repeat", hint: "этот ответ уже был — ответь на новое сообщение по существу" };
  }
  return null;
}
