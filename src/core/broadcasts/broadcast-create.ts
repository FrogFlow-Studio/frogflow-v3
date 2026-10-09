import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  AUDIENCE_TYPES,
  contentProblem,
  normalizeContent,
  type AudienceType,
  type BroadcastContent,
} from "./pure";
import {
  ACTIVE_SCAN,
  type AudienceFilter,
  type BroadcastChannel,
  type BroadcastRow,
  MAX_SCHEDULED,
} from "./broadcast-model";
import { resolveAudience, resolveWhatsAppAudience } from "./broadcast-audience";
import { isDue } from "./broadcast-batch";

/** Создание рассылки. */

export type WhatsAppTemplateRef = {
  accountId: string;
  templateName: string;
  templateLanguage: string;
  templateParams: string[];
};

export type CreateBroadcastInput = BroadcastContent & {
  audience: AudienceType;
  filter?: AudienceFilter;
  channel?: BroadcastChannel;
  /** WhatsApp: только одобренный шаблон Meta — свободный текст вне 24-часового окна не доставляется. */
  whatsapp?: WhatsAppTemplateRef;
};

export type CreateBroadcastResult =
  | { ok: true; broadcast: BroadcastRow }
  | { ok: false; reason: "invalid" | "no_recipients" | "busy" | "db"; message: string };

export async function createBroadcast(
  ctx: TenantContext,
  input: CreateBroadcastInput,
): Promise<CreateBroadcastResult> {
  const channel: BroadcastChannel = input.channel ?? "telegram";
  const content = normalizeContent(input);
  if (channel === "telegram") {
    const problem = contentProblem(content);
    if (problem) return { ok: false, reason: "invalid", message: problem };
  } else {
    if (!ctx.tenant.modules.wa_broadcasts)
      return {
        ok: false,
        reason: "invalid",
        message: "Модуль «Рассылки в WhatsApp» не подключён к вашему тарифу.",
      };
    if (!input.whatsapp?.accountId)
      return {
        ok: false,
        reason: "invalid",
        message: "Не выбран аккаунт WhatsApp, от которого идёт рассылка.",
      };
    if (!input.whatsapp.templateName)
      return {
        ok: false,
        reason: "invalid",
        message:
          "Для рассылки в WhatsApp нужен одобренный шаблон Meta — выберите его в списке шаблонов.",
      };
  }
  if (!AUDIENCE_TYPES.includes(input.audience))
    return { ok: false, reason: "invalid", message: "Неизвестная аудитория." };

  const recipients: Array<{ telegram_id: number; phone: string | null }> =
    channel === "telegram"
      ? [...new Set(await resolveAudience(ctx, input.audience, input.filter))].map((id) => ({
          telegram_id: id,
          phone: null,
        }))
      : [
          ...new Map(
            (await resolveWhatsAppAudience(ctx, input.audience, input.filter)).map((r) => [
              r.phone,
              r,
            ]),
          ).values(),
        ].map((r) => ({ telegram_id: r.telegramId, phone: r.phone }));
  // A/B-тест: этой рассылке — своя половина аудитории.
  if (input.filter?.ab) {
    const { splitForAb } = await import("./ab");
    const half = splitForAb(recipients, (r) => r.telegram_id, input.filter.ab);
    recipients.splice(0, recipients.length, ...half);
  }
  if (recipients.length === 0)
    return {
      ok: false,
      reason: "no_recipients",
      message:
        input.audience === "test"
          ? channel === "telegram"
            ? "Не настроен Telegram-id администратора (Настройки → Уведомления)."
            : "В WhatsApp нет пробной отправки себе — выберите аудиторию."
          : "Для выбранной аудитории получателей не нашлось.",
    };

  // Канал занят только идущей (или уже наступившей) рассылкой. Запланированная
  // на будущее не мешает ни другой рассылке, ни пробной себе.
  const { data: active, error: activeError } = await ctx.db
    .from("broadcasts")
    .select("id, audience_filter")
    .in("status", ["queued", "sending"])
    .eq("channel", channel)
    .order("created_at", { ascending: true })
    .limit(ACTIVE_SCAN);
  if (activeError) return { ok: false, reason: "db", message: activeError.message };
  const now = Date.now();
  const sendAt = input.filter?.send_at ? Date.parse(input.filter.send_at) : NaN;
  const scheduled = Number.isFinite(sendAt) && sendAt > now;
  if (!scheduled && (active ?? []).some((b) => isDue(b, now)))
    return {
      ok: false,
      reason: "busy",
      message: "Уже идёт рассылка — дождитесь её или остановите.",
    };
  if (scheduled && (active ?? []).filter((b) => !isDue(b, now)).length >= MAX_SCHEDULED)
    return {
      ok: false,
      reason: "busy",
      message: `Запланировано уже ${MAX_SCHEDULED} рассылок — дождитесь отправки или отмените лишние.`,
    };

  const { data: broadcast, error } = await ctx.db
    .from("broadcasts")
    .insert({
      bot_id: ctx.tenant.id,
      status: "queued",
      channel,
      message_text:
        channel === "telegram" ? content.text : `Шаблон ${input.whatsapp!.templateName}`,
      photo_paths: channel === "telegram" ? content.photoKeys : [],
      product_ids: channel === "telegram" ? content.productIds : [],
      show_catalog: channel === "telegram" ? content.showCatalog : false,
      audience_type: input.audience,
      audience_filter: input.filter ?? {},
      total_count: recipients.length,
      account_id: input.whatsapp?.accountId ?? null,
      template_name: input.whatsapp?.templateName ?? null,
      template_language: input.whatsapp?.templateLanguage ?? null,
      template_params: input.whatsapp?.templateParams ?? [],
    })
    .select("*")
    .single();
  if (error || !broadcast)
    return { ok: false, reason: "db", message: error?.message ?? "Не удалось создать рассылку" };

  const rows = recipients.map((r) => ({
    bot_id: ctx.tenant.id,
    broadcast_id: broadcast.id,
    telegram_id: r.telegram_id,
    phone: r.phone,
    status: "pending",
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await ctx.db.from("broadcast_recipients").insert(rows.slice(i, i + 500));
    if (e) {
      await ctx.db
        .from("broadcasts")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", broadcast.id);
      return { ok: false, reason: "db", message: e.message };
    }
  }
  return { ok: true, broadcast };
}
