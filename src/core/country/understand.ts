/**
 * Страна покупателя из его слов: «Я из России», «Махачкала», «кз». Понимает
 * модель (решение Якова 10.10: «чтобы не код следил, а иишка»), правила
 * здесь — только запасной путь, когда модели нет (ключ, потолок, сбой).
 * Ночью 11.10 AATeach: на «Я из России» бот прислал список стран заново, а
 * на «1» поставил Казахстан покупательнице из России. Вызов модели —
 * understand.server.ts.
 */

export type CountryChoice = { code: string; name: string };

/**
 * code — страна из списка клиента или null; onlyCountry — сообщение и есть
 * ответ страной (приветствие не в счёт), без вопроса и просьбы: на такое бот
 * отвечает сам, на остальное только запоминает страну.
 */
export type CountryReading = { code: string | null; onlyCountry: boolean };

export const COUNTRY_AI_MODEL = "claude-sonnet-5";
/** Sonnet 5, $ за миллион токенов. */
export const COUNTRY_AI_PRICE = { in: 2, out: 10 };
/** «off» — выключено у клиента; по умолчанию включено. */
export const COUNTRY_AI_ENABLED_KEY = "country_ai";
/** Потолок расхода в день, $; нет ключа — COUNTRY_AI_DAILY_USD. */
export const COUNTRY_AI_CAP_KEY = "country_ai_daily_usd";
export const countryAiSpendKey = (date: string) => `country_ai_spend:${date}`;
/** ≈0,001 $ за сообщение: 300 сообщений в день. */
export const COUNTRY_AI_DAILY_USD = 0.3;
export const COUNTRY_AI_TIMEOUT_MS = 8_000;
/** Длиннее — это уже разговор, не ответ про страну. */
export const COUNTRY_AI_MAX_TEXT = 200;

export const COUNTRY_SYSTEM = `Ты помогаешь боту магазина в Instagram/WhatsApp понять, из какой страны покупатель. От страны зависят валюта и способ оплаты. Сам ты покупателю не пишешь: ответь инструментом country.

country — код страны из списка, если покупатель говорит, где он живёт или откуда будет платить: название страны в любой форме и на любом языке («Я из России», «РФ», «кз», «Беларусь», «Kazakhstan»), город или регион («Махачкала», «живу в Бишкеке», «Алматы»), валюта или банк своей страны («рублями», «оплачу картой Сбера»). Страны нет в списке, но она названа — код «другой страны», если он есть в списке. Страна не названа, или речь о языке («на русском», «русский»), или неясно — none.

answer_only — true, если сообщение целиком и есть ответ страной (можно с приветствием или «спасибо»): «Здравствуйте, из России», «Казахстан», «РФ». false, если в нём ещё вопрос или просьба («я из России, как оплатить?», «высылаете в Беларусь?»), или страны нет.`;

export function countryTool(options: readonly CountryChoice[]) {
  return {
    name: "country",
    description: "Страна покупателя по его последнему сообщению.",
    input_schema: {
      type: "object" as const,
      properties: {
        country: { type: "string", enum: [...options.map((o) => o.code), "none"] },
        answer_only: { type: "boolean" },
      },
      required: ["country", "answer_only"],
    },
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function countryUserPrompt(p: {
  text: string;
  options: readonly CountryChoice[];
  /** Бот только что спросил страну списком. */
  asked: boolean;
}): string {
  const list = p.options.map((o, i) => `${i + 1}. ${o.code} — ${o.name}`).join("\n");
  return [
    `Страны оплаты магазина:\n${list}`,
    p.asked
      ? "Бот только что спросил покупателя, из какой он страны, и прислал этот список."
      : "Продавец в первом сообщении обычно спрашивает, из какой страны покупатель.",
    `Сообщение покупателя: «${clip(p.text.trim(), COUNTRY_AI_MAX_TEXT)}»`,
  ].join("\n\n");
}

/** Ответ модели: код только из списка клиента, иначе «страны нет». */
export function parseCountryReading(
  input: unknown,
  options: readonly CountryChoice[],
): CountryReading {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const code =
    typeof v.country === "string" && options.some((o) => o.code === v.country) ? v.country : null;
  return { code, onlyCountry: code !== null && v.answer_only === true };
}

export function countryCostUsd(
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
) {
  const i = Number(usage?.input_tokens) || 0;
  const o = Number(usage?.output_tokens) || 0;
  return Math.round(((i * COUNTRY_AI_PRICE.in + o * COUNTRY_AI_PRICE.out) / 1e6) * 1e6) / 1e6;
}

export function parseCountryCap(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isFinite(n) && n >= 0
    ? n
    : COUNTRY_AI_DAILY_USD;
}

/**
 * Запасной разбор без модели: страна по корню названия, столице или крупному
 * городу, по коду. Только однозначно: две страны в сообщении — не знаем.
 * «Русский» — язык, не страна.
 */
const STEMS: Record<string, RegExp> = {
  RU: /росси|россии|(^|[^\p{L}])(рф|russia)($|[^\p{L}])|рубл|москв|петербург|(^|[^\p{L}])питер|дагестан|махачкал|новосибирск|екатеринбург|краснодар|чечн|грозн|татарстан|башкир/iu,
  KZ: /казахстан|қазақстан|kazakhstan|qazaqstan|(^|[^\p{L}])(кз|kz|рк)($|[^\p{L}])|алмат|астан|шымкент|караганд|актоб|атырау|тенге|теңге/iu,
  KG: /кыргыз|киргиз|қырғыз|kyrgyz|(^|[^\p{L}])(кр|kg)($|[^\p{L}])|бишкек|(^|[^\p{L}])ош($|[^\p{L}])|сом($|[^\p{L}])/iu,
  BY: /беларус|белорус|belarus|(^|[^\p{L}])(рб|by)($|[^\p{L}])|минск|гомел|брест|витебск|гродн|могил/iu,
  UZ: /узбек|өзбек|o['‘’`]?zbek|uzbek|(^|[^\p{L}])(уз|uz|руз)($|[^\p{L}])|ташкент|toshkent|самарканд|бухар|андижан|наманган|ферган|нукус|сум($|[^\p{L}])|so['‘’`]?m($|[^\p{L}])/iu,
};
const QUESTION = /[?]|(^|[^\p{L}])(как|сколько|куда|можно|когда|где|высыла|отправ|достав|оплат)/iu;

export function fallbackCountry(text: string, options: readonly CountryChoice[]): CountryReading {
  const t = text.trim();
  const hits = options.filter((o) => STEMS[o.code]?.test(t));
  if (hits.length !== 1) return { code: null, onlyCountry: false };
  return { code: hits[0]!.code, onlyCountry: t.length <= 60 && !QUESTION.test(t) };
}
