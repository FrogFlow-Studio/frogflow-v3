import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database, Json } from "@/core/db-types";
import { serverFailure } from "@/lib/server-failure";

/**
 * Шаблоны WhatsApp (Meta) — локальная копия `whatsapp_templates`, чтобы
 * показывать продавцу статусы, не дёргая Zernio на каждый рендер. Источник
 * истины — Meta; вердикт ревью приходит вебхуком
 * `whatsapp.template.status_updated`, полный список — синхронизацией.
 */
export type TemplateRow = Database["public"]["Tables"]["whatsapp_templates"]["Row"];

export type FetchedTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: Json;
  reason?: string;
};

export async function listTemplates(
  ctx: TenantContext,
  accountId?: string,
): Promise<TemplateRow[]> {
  let q = ctx.db.from("whatsapp_templates").select("*").order("name");
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) throw serverFailure(error.message);
  return data ?? [];
}

const cleanReason = (r: string | null | undefined) => (r && r !== "NONE" ? r : null);

/** Привести локальный список в соответствие с Meta. */
export async function syncTemplates(
  ctx: TenantContext,
  accountId: string,
  fetched: FetchedTemplate[],
): Promise<number> {
  if (fetched.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = fetched.map((t) => ({
    bot_id: ctx.tenant.id,
    account_id: accountId,
    name: t.name,
    language: t.language,
    category: t.category ?? "UTILITY",
    status: String(t.status ?? "PENDING"),
    reason: cleanReason(t.reason),
    components: (t.components ?? []) as Json,
    updated_at: now,
  }));
  const { error } = await ctx.db
    .from("whatsapp_templates")
    .upsert(rows, { onConflict: "bot_id,account_id,name,language" });
  if (error) throw serverFailure(error.message);
  return rows.length;
}

/**
 * Вердикт ревью Meta. Обновляем только существующую запись: шаблон,
 * заведённый прямо в WhatsApp Manager, подтянет синхронизация целиком —
 * выдумывать ему категорию ради NOT NULL нельзя. Возвращает false, если
 * записи не было.
 */
export async function applyTemplateStatus(
  ctx: TenantContext,
  p: { accountId: string; name: string; language: string; status: string; reason?: string | null },
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("whatsapp_templates")
    .update({
      status: p.status || "PENDING",
      reason: cleanReason(p.reason),
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", p.accountId)
    .eq("name", p.name)
    .eq("language", p.language)
    .select("id");
  // Сбой — не «шаблона нет»: вебхук получит ошибку и придёт повторно.
  if (error) throw serverFailure(`Статус шаблона ${p.name}: ${error.message}`);
  return Boolean(data?.length);
}

/** Плейсхолдеры `{{1}}…{{n}}` в теле шаблона — сколько параметров нужно рассылке. */
export function templateParamCount(components: Json | null | undefined): number {
  if (!Array.isArray(components)) return 0;
  let max = 0;
  for (const c of components) {
    const text =
      c && typeof c === "object" && !Array.isArray(c) ? (c as { text?: unknown }).text : null;
    if (typeof text !== "string") continue;
    for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export function templateBody(components: Json | null | undefined): string {
  if (!Array.isArray(components)) return "";
  for (const c of components) {
    const o =
      c && typeof c === "object" && !Array.isArray(c)
        ? (c as { type?: unknown; text?: unknown })
        : null;
    if (o && String(o.type).toUpperCase() === "BODY" && typeof o.text === "string") return o.text;
  }
  return "";
}

/** Имя шаблона по правилам Meta: строчные латинские буквы, цифры и подчёркивания. */
export function normalizeTemplateName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}
