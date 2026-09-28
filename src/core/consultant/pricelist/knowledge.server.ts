import type { TenantContext } from "@/core/tenant/resolve.server";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  DEFAULT_KNOWLEDGE_ARTICLES,
  KNOWLEDGE_KEY,
  type ConsultantKnowledgeArticle,
} from "./knowledge";

/** База знаний магазина: строка app_settings `consultant_knowledge_json`, как у v1. */
export async function loadKnowledge(ctx: TenantContext): Promise<ConsultantKnowledgeArticle[]> {
  try {
    const parsed = JSON.parse((await getSetting(ctx, KNOWLEDGE_KEY)) ?? "") as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as ConsultantKnowledgeArticle[];
  } catch {
    // пусто или испорчено — умолчания
  }
  return DEFAULT_KNOWLEDGE_ARTICLES;
}

export async function saveKnowledge(
  ctx: TenantContext,
  articles: ConsultantKnowledgeArticle[],
): Promise<void> {
  await setSetting(ctx, KNOWLEDGE_KEY, JSON.stringify(articles));
}
