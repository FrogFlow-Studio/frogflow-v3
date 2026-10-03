import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { duplicateOf, type LeadInput } from "@/core/leads/leads";
import {
  buildHuntPrompt,
  mergeHits,
  parseHuntLeads,
  parseSearchHits,
  searchQueries,
  type SearchHit,
} from "@/core/leads/hunt";
import { LEAD_SCORE_MODEL } from "@/core/leads/score";
import { serverFailure } from "@/lib/server-failure";
import { PREVIEW_AI_OFF, previewReadonly } from "@/lib/preview";
import { insertLead, listLeads } from "./leads.server";

/**
 * Автопоиск лидов по кнопке: два запроса в DuckDuckGo (HTML, как в v1), из выдачи ИИ
 * достаёт бизнесы с контактами, дубли по Instagram, телефону, почте и сайту отсекаются,
 * новые уходят в «Новый» с источником `hunt`. У каждого вызова свой тайм-аут, общий
 * бюджет — меньше 120 с функции. Ничего никому не отправляется.
 */
const SEARCH_TIMEOUT_MS = 10_000;
const MODEL_TIMEOUT_MS = 45_000;
const BUDGET_MS = 90_000;
const SEARCH_URL = "https://html.duckduckgo.com/html/";
const USER_AGENT = "Mozilla/5.0 (compatible; FrogFlowLeadSearch/1.0; +https://www.frogflow.tech)";

export type HuntResult = {
  /** Сколько бизнесов ИИ достал из выдачи. */
  found: number;
  added: number;
  duplicates: number;
  /** Названия добавленных лидов. */
  names: string[];
  /** Пояснение, если искать не удалось или ничего не нашлось. */
  note: string | null;
};

async function searchOnce(query: string): Promise<SearchHit[]> {
  const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  // 202 у DuckDuckGo — страница проверки «вы не робот»: выдачи в ней нет.
  if (res.status !== 200) throw new Error(`DuckDuckGo ответил ${res.status}`);
  return parseSearchHits(await res.text());
}

export async function huntLeads(
  p: { niche: string; city: string },
  actor: string,
  startedAt = Date.now(),
): Promise<HuntResult> {
  // Каждый вызов модели — деньги платформы; в предпросмотре кнопка отвечает понятной причиной.
  if (previewReadonly()) throw new Error(PREVIEW_AI_OFF);
  const apiKey = env().ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw serverFailure("ИИ-ключ платформы не задан — автопоиск лидов недоступен");
  const niche = p.niche.trim().slice(0, 80);
  const city = p.city.trim().slice(0, 80);
  const empty = (note: string): HuntResult => ({
    found: 0,
    added: 0,
    duplicates: 0,
    names: [],
    note,
  });
  if (!niche) return empty("Укажите нишу");

  const lists: SearchHit[][] = [];
  let failed = 0;
  for (const q of searchQueries(niche, city)) {
    if (Date.now() - startedAt > BUDGET_MS / 2) break;
    try {
      lists.push(await searchOnce(q));
    } catch (e) {
      failed++;
      console.error(`[leads:hunt] поиск «${q}»: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const hits = mergeHits(lists);
  if (hits.length === 0)
    return empty(
      failed > 0 && lists.length === 0
        ? "Поиск сейчас недоступен (DuckDuckGo не отвечает или просит проверку) — повторите позже."
        : "Поиск ничего не вернул — попробуйте другую нишу или город.",
    );

  let reply: string;
  try {
    const response = await new Anthropic({
      apiKey,
      maxRetries: 0,
      timeout: Math.min(MODEL_TIMEOUT_MS, Math.max(5_000, BUDGET_MS - (Date.now() - startedAt))),
    }).messages.create({
      model: LEAD_SCORE_MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: buildHuntPrompt(niche, city, hits) }],
    });
    reply = response.content.find((b) => b.type === "text")?.text ?? "";
  } catch (e) {
    throw serverFailure(`ИИ: автопоиск лидов: ${e instanceof Error ? e.message : String(e)}`);
  }
  const candidates = parseHuntLeads(reply, { niche, city });
  if (candidates.length === 0)
    return empty("В выдаче не нашлось подходящих бизнесов с контактами.");

  // Дубли — против воронки и между собой: каждый добавленный сразу попадает в список сверки.
  const known: Array<
    Pick<LeadInput, "websiteUrl" | "instagramHandle" | "phone" | "email"> & { name: string }
  > = (await listLeads()).map((l) => ({
    name: l.business_name,
    websiteUrl: l.website_url,
    instagramHandle: l.instagram_handle,
    phone: l.phone,
    email: l.email,
  }));
  const names: string[] = [];
  let duplicates = 0;
  for (const c of candidates) {
    if (duplicateOf(known, c)) {
      duplicates++;
      continue;
    }
    await insertLead(c, actor, "hunt", `Найден автопоиском: ${niche}${city ? `, ${city}` : ""}`);
    known.push({ ...c, name: c.businessName });
    names.push(c.businessName);
  }
  return {
    found: candidates.length,
    added: names.length,
    duplicates,
    names,
    note: names.length === 0 ? "Все найденные уже есть в воронке." : null,
  };
}
