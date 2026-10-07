import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSettingStrict, setSetting, updateSettingStamped } from "@/core/settings/settings";
import { UserError } from "@/core/i18n/user-error";
import { serverFailure } from "@/lib/server-failure";
import {
  DEFAULT_KNOWLEDGE_ARTICLES,
  KNOWLEDGE_KEY,
  type ConsultantKnowledgeArticle,
} from "./knowledge";
import { KNOWLEDGE_MAX_ARTICLES, mergeKnowledge, type ImportedArticle } from "./knowledge-import";

/** Статьи из значения строки; пусто или испорчено — умолчания (как видит их админка). */
function articlesOf(raw: string | null): ConsultantKnowledgeArticle[] {
  try {
    const parsed = JSON.parse(raw ?? "") as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as ConsultantKnowledgeArticle[];
  } catch {
    // пусто или испорчено — умолчания
  }
  return DEFAULT_KNOWLEDGE_ARTICLES;
}

/**
 * База знаний магазина: строка app_settings `consultant_knowledge_json`, как у v1.
 * Сбой чтения — ошибка (serverFailure), а не статьи по умолчанию: «не удалось
 * прочитать» ≠ «не заполнено» — иначе консультант молча отвечал без базы, а
 * админка показала бы умолчания поверх настоящих статей.
 */
export async function loadKnowledge(ctx: TenantContext): Promise<ConsultantKnowledgeArticle[]> {
  return articlesOf(await getSettingStrict(ctx, KNOWLEDGE_KEY));
}

export async function saveKnowledge(
  ctx: TenantContext,
  articles: ConsultantKnowledgeArticle[],
): Promise<void> {
  await setSetting(ctx, KNOWLEDGE_KEY, JSON.stringify(articles));
}

/**
 * Дописать загруженные статьи к базе (mergeKnowledge): прежние остаются все.
 * Запись условная по метке updated_at строки (updateSettingStamped): база —
 * длинный текст, условие на всё значение дало бы 431. Две загрузки сразу или
 * сохранение статей в соседней вкладке не затрут друг друга — проигравший
 * перечитывает базу и сливает заново.
 */
export async function appendKnowledge(
  ctx: TenantContext,
  incoming: ImportedArticle[],
  now = new Date(),
): Promise<{ added: number; updated: number; total: number }> {
  let result = { added: 0, updated: 0, total: 0 };
  let overflow = 0;
  const outcome = await updateSettingStamped(ctx, KNOWLEDGE_KEY, (raw) => {
    const merged = mergeKnowledge(articlesOf(raw), incoming, now);
    if (merged.articles.length > KNOWLEDGE_MAX_ARTICLES) {
      overflow = merged.articles.length;
      return null;
    }
    overflow = 0;
    result = { added: merged.added, updated: merged.updated, total: merged.articles.length };
    return JSON.stringify(merged.articles);
  });
  if (overflow)
    throw new UserError(
      "err.pricelist.kbTooMany",
      "В базе знаний было бы {count} статей, а помещается {max}. Удалите лишние или объедините статьи.",
      { count: overflow, max: KNOWLEDGE_MAX_ARTICLES },
    );
  if (outcome !== "written") throw serverFailure("База знаний: статьи не дописались");
  return result;
}
