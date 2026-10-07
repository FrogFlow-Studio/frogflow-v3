/**
 * База знаний консультанта из строки другого клиента (`app_settings`, ключ
 * `consultant_knowledge_json`). v1 писал эту строку без явного `bot_id` — его
 * подставлял триггер или DEFAULT колонки (MIGRATION-01/02), поэтому статьи
 * переехавшего клиента лежат под чужим `bot_id` и в v2 он видит умолчания.
 * Оператор смотрит все такие строки и переносит нужную в своего клиента;
 * строка-источник не меняется, перенос — тем же слиянием, что загрузка
 * статей у продавца (mergeKnowledge в appendKnowledge).
 */
import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { inChunks } from "@/lib/in-chunks";
import { serverFailure } from "@/lib/server-failure";
import {
  DEFAULT_KNOWLEDGE_ARTICLES,
  KNOWLEDGE_KEY,
  type ConsultantKnowledgeArticle,
} from "@/core/consultant/pricelist/knowledge";
import { appendKnowledge } from "@/core/consultant/pricelist/knowledge.server";
import type { ImportedArticle } from "@/core/consultant/pricelist/knowledge-import";
import { requireTenant, tenantContext } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";

/** Сколько заголовков показываем в списке: содержимое статей наружу не отдаём. */
const TITLES_SHOWN = 5;
const TITLE_CUT = 120;

export type KnowledgeSource = {
  botId: string;
  /** Имя клиента из `bots`; строка могла остаться без клиента — тогда null. */
  botName: string | null;
  archived: boolean;
  /** Сколько статей в строке; испорченное значение — 0 и `broken`. */
  articles: number;
  broken: boolean;
  /** Первые заголовки, без содержимого статей. */
  titles: string[];
  updatedAt: string | null;
  /** Это строка самого клиента, которого смотрит оператор. */
  own: boolean;
};

export type KnowledgeSources = {
  /** Строка клиента, если она есть. */
  own: KnowledgeSource | null;
  /** Сколько статей видит консультант клиента сейчас (умолчания, если строки нет). */
  current: number;
  /** Статьи клиента — только стандартные (строки нет или она испорчена). */
  defaults: boolean;
  /** Строки остальных клиентов — откуда можно перенести. */
  others: KnowledgeSource[];
};

/** `app_settings.bot_id` в схеме допускает null (строка платформы) — такие пропускаем. */
type Row = { bot_id: string | null; value: string | null; updated_at: string | null };

/** Статьи из значения строки — только разбор, без умолчаний. */
function parse(raw: string | null): ConsultantKnowledgeArticle[] | null {
  try {
    const parsed = JSON.parse(raw ?? "") as unknown;
    return Array.isArray(parsed) ? (parsed as ConsultantKnowledgeArticle[]) : null;
  } catch {
    return null;
  }
}

/** Заголовок статьи строкой — для списка у оператора. */
function titleOf(a: unknown): string {
  const t = a && typeof a === "object" ? (a as { title?: unknown }).title : null;
  return (typeof t === "string" ? t.trim() : "") || "без заголовка";
}

/**
 * Все строки `consultant_knowledge_json` по всем клиентам, постранично и по
 * `bot_id` (вместе с фиксированным ключом это первичный ключ — сортировка
 * уникальна). Сбой чтения любой стороны — ServerFailure: «не прочитали» ≠
 * «строк нет», иначе оператор решил бы, что статей нигде нет.
 */
export async function listKnowledgeSources(botId: string): Promise<KnowledgeSources> {
  const rows = await pageAll<Row>(
    (from, to) =>
      serviceDb()
        .from("app_settings")
        .select("bot_id, value, updated_at")
        .eq("key", KNOWLEDGE_KEY)
        .order("bot_id", { ascending: true })
        .range(from, to),
    "строки базы знаний консультанта",
  );
  const withBot = rows.filter((r): r is Row & { bot_id: string } => Boolean(r.bot_id));
  const names = new Map<string, { name: string; archived: boolean }>();
  for (const b of await inChunks<
    string,
    { id: string; bot_name: string; archived_at: string | null }
  >(
    withBot.map((r) => r.bot_id),
    (chunk) => serviceDb().from("bots").select("id, bot_name, archived_at").in("id", chunk),
    "клиенты строк базы знаний",
  ))
    names.set(b.id, { name: b.bot_name, archived: Boolean(b.archived_at) });
  const sources = withBot.map((r): KnowledgeSource => {
    const articles = parse(r.value);
    const bot = names.get(r.bot_id);
    return {
      botId: r.bot_id,
      botName: bot?.name ?? null,
      archived: bot?.archived ?? false,
      articles: articles?.length ?? 0,
      broken: articles === null,
      titles: (articles ?? []).slice(0, TITLES_SHOWN).map((a) => titleOf(a).slice(0, TITLE_CUT)),
      updatedAt: r.updated_at,
      own: r.bot_id === botId,
    };
  });
  const own = sources.find((s) => s.own) ?? null;
  const defaults = !own || own.broken || own.articles === 0;
  return {
    own,
    current: defaults ? DEFAULT_KNOWLEDGE_ARTICLES.length : own.articles,
    defaults,
    others: sources.filter((s) => !s.own),
  };
}

/** Статьи источника к виду загрузки: без id и даты — их проставит слияние. */
function incomingOf(articles: ConsultantKnowledgeArticle[]): ImportedArticle[] {
  const out: ImportedArticle[] = [];
  for (const a of articles) {
    if (!a || typeof a !== "object") continue;
    const title = typeof a.title === "string" ? a.title.trim() : "";
    const content = typeof a.content === "string" ? a.content.trim() : "";
    if (!title || !content) continue;
    const tags = Array.isArray(a.tags)
      ? a.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "")
      : [];
    out.push({ title, tags, content });
  }
  return out;
}

/**
 * Перенести статьи строки `sourceBotId` в базу знаний клиента `botId`.
 * Прежние статьи клиента остаются все, статья с тем же заголовком
 * обновляется — поэтому повторный перенос не плодит дублей. Предел 200 статей
 * — ошибка (UserError из appendKnowledge), а не молчаливая обрезка. Строку
 * источника перенос не трогает. Клиент должен уже обслуживаться v2
 * (servedByV2): его строку статей на v1 читает прежняя платформа.
 */
export async function importKnowledgeFrom(
  botId: string,
  sourceBotId: string,
  actor = "operator",
): Promise<{ added: number; updated: number; total: number; from: string }> {
  if (sourceBotId === botId)
    throw new Error("Это и есть строка самого клиента — переносить нечего.");
  const { data, error } = await serviceDb()
    .from("app_settings")
    .select("value")
    .eq("bot_id", sourceBotId)
    .eq("key", KNOWLEDGE_KEY)
    .maybeSingle();
  if (error) throw serverFailure(`Статьи источника не прочитаны: ${error.message}`);
  if (!data) throw new Error("У источника нет строки базы знаний: обновите список.");
  const incoming = incomingOf(parse(data.value) ?? []);
  if (!incoming.length) throw new Error("В строке источника нет статей с заголовком и текстом.");
  const tenant = await requireTenant({ by: "id", value: botId });
  // Клиент на прежней платформе невидим для v2: его строку статей читает и
  // пишет v1, и перенос менял бы ответы живого бота v1.
  if (!servedByV2(tenant))
    throw new Error(
      "Клиент ещё на прежней платформе (v1): сначала переключите обслуживание на v2.",
    );
  const r = await appendKnowledge(tenantContext(tenant), incoming);
  const { logEvent } = await import("./operator.server");
  await logEvent(
    botId,
    "meta",
    {
      consultant_knowledge_imported: r.added,
      consultant_knowledge_updated: r.updated,
      consultant_knowledge_total: r.total,
      from_bot_id: sourceBotId,
    },
    actor,
  );
  return { ...r, from: sourceBotId };
}
