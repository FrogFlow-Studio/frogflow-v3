/**
 * Шаблоны WhatsApp (Meta) через Zernio: синхронизация списка, заявка на
 * новый шаблон, вердикт ревью вебхуком. Локальная копия — в
 * `whatsapp_templates` (core/whatsapp/templates), источник истины — Meta.
 */
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  applyTemplateStatus,
  normalizeTemplateName,
  syncTemplates,
  type FetchedTemplate,
} from "@/core/whatsapp/templates";
import { createWhatsAppTemplate, listWhatsAppTemplates, type WhatsAppTemplate } from "./api.server";

export type TemplateApi = {
  list: (accountId: string) => Promise<WhatsAppTemplate[]>;
  create: typeof createWhatsAppTemplate;
};

const liveApi: TemplateApi = { list: listWhatsAppTemplates, create: createWhatsAppTemplate };

/** Аккаунт WhatsApp принадлежит клиенту — иначе можно было бы читать чужие шаблоны по id. */
export function ownsWhatsAppAccount(ctx: TenantContext, accountId: string): boolean {
  const z = ctx.tenant.settings.zernio;
  return Boolean(
    z?.accounts?.some((a) => a.id === accountId && a.platform === "whatsapp") ||
    z?.account_ids?.includes(accountId),
  );
}

export async function syncWhatsAppTemplates(
  ctx: TenantContext,
  accountId: string,
  api: TemplateApi = liveApi,
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!ownsWhatsAppAccount(ctx, accountId))
    return { ok: false, count: 0, error: "Этот аккаунт WhatsApp не подключён к вашему магазину." };
  try {
    const fetched: FetchedTemplate[] = await api.list(accountId);
    return { ok: true, count: await syncTemplates(ctx, accountId, fetched) };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export type NewTemplateInput = {
  accountId: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
};

/**
 * Заявка на шаблон: тело с плейсхолдерами `{{1}}…{{n}}` уходит в Meta как
 * компонент BODY, локально запись заводится в статусе PENDING — вердикт
 * придёт вебхуком `whatsapp.template.status_updated`.
 */
export async function submitWhatsAppTemplate(
  ctx: TenantContext,
  input: NewTemplateInput,
  api: TemplateApi = liveApi,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!ownsWhatsAppAccount(ctx, input.accountId))
    return { ok: false, error: "Этот аккаунт WhatsApp не подключён к вашему магазину." };
  const name = normalizeTemplateName(input.name);
  if (!name) return { ok: false, error: "Имя шаблона: строчные латинские буквы, цифры и «_»." };
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Текст шаблона пуст." };
  const components = [{ type: "BODY", text: body }];
  const r = await api.create({
    accountId: input.accountId,
    name,
    category: input.category,
    language: input.language,
    components,
  });
  if (!r.ok) return { ok: false, error: r.error };
  await syncTemplates(ctx, input.accountId, [
    {
      name: r.template?.name ?? name,
      language: r.template?.language ?? input.language,
      status: r.template?.status ?? "PENDING",
      category: r.template?.category ?? input.category,
      components: r.template?.components ?? components,
      reason: r.template?.reason,
    },
  ]);
  return { ok: true, name };
}

export type TemplateStatusPayload = {
  account?: { accountId?: string; id?: string; _id?: string };
  template?: Partial<WhatsAppTemplate>;
  data?: Partial<WhatsAppTemplate>;
};

/**
 * Вердикт ревью Meta. Zernio кладёт шаблон то в `template`, то в `data`.
 * Запись, заведённую мимо панели (в WhatsApp Manager), обновлять нечем —
 * подтягиваем список целиком.
 */
export async function handleTemplateStatus(
  ctx: TenantContext,
  payload: TemplateStatusPayload,
  api: TemplateApi = liveApi,
): Promise<{ note: string }> {
  const t = payload.template ?? payload.data ?? {};
  const accountId = payload.account?.accountId || payload.account?.id || payload.account?._id;
  if (!accountId || !t.name || !t.language) return { note: "без accountId/name/language" };
  const updated = await applyTemplateStatus(ctx, {
    accountId,
    name: t.name,
    language: t.language,
    status: String(t.status ?? "PENDING"),
    reason: t.reason,
  });
  if (updated) return { note: `${t.name}/${t.language}: ${t.status ?? "PENDING"}` };
  const s = await syncWhatsAppTemplates(ctx, accountId, api);
  return { note: s.ok ? `синхронизировано ${s.count}` : `не синхронизировано: ${s.error}` };
}
