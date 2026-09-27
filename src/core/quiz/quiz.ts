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

export function splitTags(raw: string | string[] | undefined): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\n]+/);
  return Array.from(
    new Set(list.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2)),
  ).slice(0, 10);
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

export type QuizProduct = {
  id: string;
  name: string;
  keywords: string | null;
  description: string | null;
};

/** Очки товара: сколько тегов ответов встречается в названии, ключевых словах, описании. */
export function scoreProducts<T extends QuizProduct>(
  products: readonly T[],
  tags: readonly string[],
  limit = 3,
): T[] {
  const wanted = splitTags([...tags]);
  if (!wanted.length) return [];
  return products
    .map((p) => {
      const hay = `${p.name} ${p.keywords ?? ""} ${p.description ?? ""}`.toLowerCase();
      return { p, score: wanted.filter((t) => hay.includes(t)).length };
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
