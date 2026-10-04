import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import { allActiveProducts } from "@/core/catalog/active";

/**
 * Квиз-подбор (модуль quiz): до 5 вопросов с вариантами кнопками; у
 * каждого варианта — теги (слова через запятую). В конце товары получают
 * очки за каждый тег, найденный в названии, ключевых словах или описании;
 * бот показывает до трёх лучших. Настройка — `app_settings.quiz`.
 */
export type QuizOption = { label: string; tags: string[] };
export type QuizQuestion = { text: string; options: QuizOption[] };
export type Quiz = { intro: string; questions: QuizQuestion[] };

export const QUIZ_KEY = "quiz";
export const QUIZ_MAX_QUESTIONS = 5;
export const QUIZ_MAX_OPTIONS = 6;

/** `max` — потолок тегов одного варианта при вводе продавцом; при подсчёте ответов потолка нет. */
export function splitTags(raw: string | string[] | undefined, max = 10): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\n]+/);
  return Array.from(
    new Set(list.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2)),
  ).slice(0, max);
}

export function parseQuiz(raw: string | null | undefined): Quiz {
  const empty: Quiz = { intro: "", questions: [] };
  if (!raw) return empty;
  try {
    const p = JSON.parse(raw) as Partial<Quiz>;
    const questions = Array.isArray(p.questions)
      ? p.questions
          .map((q) => ({
            text: typeof q?.text === "string" ? q.text.trim().slice(0, 300) : "",
            options: Array.isArray(q?.options)
              ? q.options
                  .map((o) => ({
                    label: typeof o?.label === "string" ? o.label.trim().slice(0, 40) : "",
                    tags: splitTags(o?.tags as string[] | string | undefined),
                  }))
                  .filter((o) => o.label)
                  .slice(0, QUIZ_MAX_OPTIONS)
              : [],
          }))
          .filter((q) => q.text && q.options.length >= 2)
          .slice(0, QUIZ_MAX_QUESTIONS)
      : [];
    return { intro: typeof p.intro === "string" ? p.intro.trim().slice(0, 500) : "", questions };
  } catch {
    return empty;
  }
}

/**
 * Ответ на вопрос q вариантом i. Теги копятся от вопроса к вопросу; ответ на
 * первый вопрос начинает подбор заново. null — такого вопроса или варианта нет
 * (устаревшая кнопка, неверный номер). Единственное место, где ответы
 * превращаются в теги: Telegram, Instagram/WhatsApp и сайт только зовут его.
 */
export function quizAnswer(
  quiz: Quiz,
  tags: readonly string[],
  q: number,
  i: number,
): { tags: string[]; next: number; done: boolean } | null {
  const option = quiz.questions[q]?.options[i];
  if (!option || !Number.isInteger(q) || !Number.isInteger(i)) return null;
  const prev = q === 0 ? [] : [...tags];
  return { tags: [...prev, ...option.tags], next: q + 1, done: q + 1 >= quiz.questions.length };
}

/** Теги по полному набору ответов (сайт): номера вариантов по порядку вопросов; неполный или неверный набор — null. */
export function tagsForAnswers(quiz: Quiz, answers: readonly number[]): string[] | null {
  if (!quiz.questions.length || answers.length !== quiz.questions.length) return null;
  let tags: string[] = [];
  for (const [q, i] of answers.entries()) {
    const step = quizAnswer(quiz, tags, q, i);
    if (!step) return null;
    tags = step.tags;
  }
  return tags;
}

export type QuizProduct = {
  id: string;
  name: string;
  keywords: string | null;
  description: string | null;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Тег — начало слова (основа, как «пропис», «детск»), а не любая подстрока: «кот» не находит
 * «скотч». Короткий тег (до 3 букв) берёт слово целиком или с окончанием до 2 букв («кот»,
 * «кота», «коты»), иначе он совпадал бы с «который» и «котёнок»: для такого слова продавец
 * пишет свой тег («котён»). Тег от 4 букв берёт любое продолжение слова. Регистр и «ё»
 * не важны, буквы любые (кириллица, казахские и узбекские).
 */
function tagMatcher(tag: string): RegExp | null {
  const t = norm(tag);
  if (!t) return null;
  const tail = t.length <= 3 ? "\\p{L}{0,2}" : "\\p{L}*";
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}${tail}(?![\\p{L}\\p{N}])`, "u");
}

/** Очки товара: сколько тегов ответов встречается в названии, ключевых словах, описании (по началу слова). */
export function scoreProducts<T extends QuizProduct>(
  products: readonly T[],
  tags: readonly string[],
  limit = 3,
): T[] {
  // Все теги ответов: потолок в 10 тегов относится к вводу продавца, а не к подсчёту, иначе
  // варианты поздних вопросов молча не учитывались бы.
  const wanted = splitTags([...tags], Infinity)
    .map(tagMatcher)
    .filter((re): re is RegExp => re !== null);
  if (!wanted.length) return [];
  return products
    .map((p) => {
      const hay = norm(`${p.name} ${p.keywords ?? ""} ${p.description ?? ""}`);
      return { p, score: wanted.filter((re) => re.test(hay)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

export async function loadQuiz(ctx: TenantContext): Promise<Quiz> {
  return parseQuiz(await getSetting(ctx, QUIZ_KEY));
}

export async function saveQuiz(ctx: TenantContext, quiz: Quiz): Promise<void> {
  await setSetting(ctx, QUIZ_KEY, JSON.stringify(quiz));
}

/** Подбор по тегам среди товаров в продаже (и на складе, если учёт включён). */
export async function quizResult<T extends QuizProduct = QuizProduct>(
  ctx: TenantContext,
  tags: readonly string[],
): Promise<T[]> {
  const all = await allActiveProducts<QuizProduct & { stock_quantity: number | null }>(
    ctx,
    "id, name, keywords, description, stock_quantity",
  );
  const stockOn = ctx.tenant.modules.stock;
  const rows = all.filter((p) => !(stockOn && p.stock_quantity != null && p.stock_quantity <= 0));
  return scoreProducts(rows, tags) as unknown as T[];
}
