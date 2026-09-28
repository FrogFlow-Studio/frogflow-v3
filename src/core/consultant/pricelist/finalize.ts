/**
 * Ответ модели перед отправкой покупателю (перенос finalizeV2Text и его
 * зависимостей из v1: copy.ts, validate.ts). Только защита и просьбы
 * магазина, без переписывания смысла: разметка и эмодзи — магазин просил без
 * них; пересказ служебных пометок и реплики «за покупателя» — утечка и брак.
 */
import type { ConsultantProduct } from "./catalog";
import { categoryOf } from "./prompt";
import {
  brandVocabulary,
  fixBrandSpelling,
  humanizePunctuation,
  stripExclamationsAndEmoji,
} from "./style";

/** Граница предложения. Без флагов — значит без общего состояния между вызовами. */
const SENTENCE_SPLIT_RE = /(?<=[.!?…])\s+/;

/** Убирает из текста предложения, на которые сработало условие. */
function dropSentences(text: string, drop: (sentence: string) => boolean): string {
  if (!text) return "";
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const parts = line.split(SENTENCE_SPLIT_RE);
    const keptParts = parts.filter((part) => !drop(part));
    const joined = keptParts.join(" ").trim();
    // Строка ушла целиком — убираем её вместе с переводом строки.
    if (keptParts.length !== parts.length && !joined) continue;
    kept.push(joined);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Матрасы средней жёсткости сняты с производства — продавец просил не
 * упоминать их вовсе. Из прайса и поиска они убраны (catalog.ts), но те же
 * линейки описаны в статьях базы знаний, и модель может назвать MEDIUM, ничего
 * не искав. Вырезается предложение, где такой матрас предлагается; честный
 * отказ («матрасов средней жёсткости сейчас нет») остаётся (v1 validate.ts).
 */
const MATTRESS_WORD_RE = /(?<![а-яё])матрас|mattress/i;
/** Линейки матрасов магазина: слово «матрас» модель часто опускает. Топперы — не матрасы. */
const MATTRESS_LINE_RE =
  /(?<![a-zа-яё])(?:former|levant|tresor|sfera|epic|frankenstolz)(?![a-zа-яё])/i;
// \w в JavaScript — только латиница: окончания перечислены кириллическим классом.
const MEDIUM_HARDNESS_RE =
  /(?<![a-zа-яё])medium(?![a-zа-яё])|средн[а-яё]*\s+(?:по\s+)?(?:жёстк|жестк)[а-яё]*|(?:жёстк|жестк)[а-яё]*\s+средн[а-яё]*/i;
const HARDNESS_DENIAL_RE =
  /(?<![а-яё])нет(?![а-яё])|не\s+прода|сн[ня]т[а-яё]*\s+с\s+производств|не\s+выпуска|закончил|не\s+остал|больше\s+не|отсутству/i;

export function offersDiscontinuedMattress(sentence: string): boolean {
  if (!MATTRESS_WORD_RE.test(sentence) && !MATTRESS_LINE_RE.test(sentence)) return false;
  if (!MEDIUM_HARDNESS_RE.test(sentence)) return false;
  return !HARDNESS_DENIAL_RE.test(sentence);
}

/** Ответ на случай, когда от текста после вырезания ничего не осталось. */
export const DISCONTINUED_MEDIUM_MATTRESS_REPLY =
  "Матрасов средней жёсткости сейчас нет — эту линейку сняли с производства. Есть комфортные (Soft) и упругие (Firm), показать варианты?";

export function cleanDiscontinuedMattressOffers(text: string): string {
  return dropSentences(text, offersDiscontinuedMattress);
}

/** Очистка markdown-разметки (*, **, #), которую Instagram Direct не показывает. */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*{2,}([\s\S]*?)\*{2,}/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1$2$3")
    .replace(/\*{2,}/g, "")
    .replace(/^(\s*)\*\s+/gm, "$1• ")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/** Реплика «за покупателя» («Клиент: …») — всё с неё и дальше отрезается. */
export function cleanScriptHallucinations(text: string): string {
  if (!text) return "";
  const scriptIdx = text.search(
    /(?:^|\n)\s*(?:customer|client|user|клиент|покупатель|пользователь|assistant|ассистент)\s*:/i,
  );
  return scriptIdx !== -1 ? text.slice(0, scriptIdx).trim() : text;
}

/**
 * Пересказ служебных пометок покупателю. 23.09 v1 ответил живой покупательнице
 * «Понял. Цены буду называть в тенге, страну не спрашиваю» — это была наша
 * пометка для модели.
 */
const INSTRUCTION_ECHO_RE = new RegExp(
  [
    "страну\\s+не\\s+спрашива",
    "цены\\s+(?:буду\\s+)?называ[а-яё]*\\s+в\\s+тенге",
    "добавлю\\s+строку",
    "по\\s+(?:вашей\\s+|этой\\s+)?инструкци",
    "согласно\\s+инструкци",
    "системн[а-яё]*\\s+(?:промпт|инструкц|сообщени)",
    "справочн[а-яё]*\\s+данн",
    "^\\s*понял[а]?\\s*[.!]?\\s*$",
  ].join("|"),
  "i",
);

export function cleanInstructionEcho(text: string): string {
  const cleaned = dropSentences(text, (sentence) => INSTRUCTION_ECHO_RE.test(sentence));
  return cleaned.trim() ? cleaned : text;
}

/**
 * Отговорка про каталог: «в каталоге не указан состав». Продавец: «сколько
 * есть инфо, пусть даст» — покупателю не объясняют устройство нашей базы.
 */
const CATALOG_EXCUSE_RE =
  /в (?:нашем\s+)?каталоге\s+(?:не\s+(?:указан|прописан|содержится|представлен)|нет\s+(?:детальн|подробн|информац)|отсутству)|(?:детальн|подробн)[а-яё]*\s+характеристик[а-яё]*[^.]{0,40}не\s+указан|у\s+меня\s+нет\s+(?:детальн[а-яё]*\s+)?информации\s+о\s+(?:состав|материал)/i;

export function isCatalogExcuse(sentence: string): boolean {
  return CATALOG_EXCUSE_RE.test(sentence);
}

export function cleanCatalogExcuses(text: string): string {
  const cleaned = dropSentences(text, isCatalogExcuse);
  // От ответа ничего не осталось — отговорка была всем ответом, лучше исходный.
  return cleaned.trim() ? cleaned : text;
}

/** «Понял.» в начале ответа: покупатель ничего не поручал. Продавец 23.09: «И „понял“ говорит постоянно». */
const LEADING_ACK_RE =
  /^\s*(?:понял[а]?|поняли|понимаю|понятно|хорошо|ясно|отлично|конечно|принято)(?:\s*[,.!…:—–-])+\s*/i;

export function stripLeadingAcknowledgement(text: string): string {
  if (!text) return text;
  let out = text;
  for (let i = 0; i < 2; i++) {
    const next = out.replace(LEADING_ACK_RE, "");
    if (next === out || !next.trim()) break;
    out = next;
  }
  return out === text ? text : out.charAt(0).toUpperCase() + out.slice(1);
}

export function finalizePricelistText(raw: string, catalog: ConsultantProduct[]): string {
  let text = cleanScriptHallucinations(raw ?? "");
  text = cleanInstructionEcho(text);
  // Снятый матрас — вырезать; ничего не осталось — честный отказ.
  if (text.trim())
    text = cleanDiscontinuedMattressOffers(text) || DISCONTINUED_MEDIUM_MATTRESS_REPLY;
  // «В каталоге не указан состав» — покупателю не объясняют устройство базы.
  text = cleanCatalogExcuses(text);
  text = fixBrandSpelling(text, brandVocabulary(catalog));
  text = stripLeadingAcknowledgement(text);
  return humanizePunctuation(stripExclamationsAndEmoji(stripMarkdownFormatting(text))).trim();
}

/** Сумма в рублях в тексте модели: «8 960 ₽», «8960 руб.», «9 000 рублей»; не «2 рубашки». */
const RUBLE_AMOUNT_RE = /\d(?:[\d \u00a0\u202f.,]*\d)?[ \u00a0\u202f]?(?:₽|руб(?![а-км-яё]))/i;

/**
 * Модель сама посчитала рубли. 25.09, тест v1: на «сколько в рублях?» Haiku
 * написала рубли по своему курсу — все суммы на 5 % ниже магазинных. Ответ
 * переспрашивается один раз с ценами в тенге, в рубли их переводит код.
 */
export function writesRubles(text: string): boolean {
  return RUBLE_AMOUNT_RE.test(text);
}

/**
 * Карточки выдачи (search_products — списком, get_product — одна) с разделом
 * без чужой серии: у коврика Maks не «Коврики LONDON», а «Коврики» (categoryOf).
 */
export function withModelCategories(result: unknown): unknown {
  const isCard = (x: unknown): x is { name: string; category: string } =>
    Boolean(x) &&
    typeof x === "object" &&
    typeof (x as { name?: unknown }).name === "string" &&
    typeof (x as { category?: unknown }).category === "string";
  const fix = (x: unknown) => (isCard(x) ? { ...x, category: categoryOf(x) } : x);
  if (isCard(result)) return fix(result);
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { products?: unknown }).products)
  ) {
    const r = result as { products: unknown[] };
    return { ...r, products: r.products.map(fix) };
  }
  return result;
}

const INJECTION_RE =
  /ignore (all )?(previous|above)|забыть (все )?инструкции|reveal (the )?(system )?prompt|покажи (системн|промпт)|api[_-]?key|anthropic|you are now|jailbreak|developer mode/i;

/** Попытка взломать подсказку — менеджеру, модель её не видит (как в v1). */
export function looksLikePromptInjection(text: string): boolean {
  return INJECTION_RE.test(text);
}
