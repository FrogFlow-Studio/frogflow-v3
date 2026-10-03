import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import { adminRecipients } from "@/core/notify/recipients";
import {
  AUDIENCE_TYPES,
  BATCH_SIZE,
  CLAIM_STALE_MS,
  SEND_DELAY_MS,
  STALE_CLAIM_ERROR,
  classifyDeliveryError,
  contentProblem,
  finalStatus,
  isRealTelegramChat,
  normalizeContent,
  type AudienceType,
  type BroadcastContent,
} from "./pure";
import { parseSegment, segmentMembers, type Segment } from "./segments";

export type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];
export type AudienceFilter = {
  country_code?: string;
  /** Сегмент при аудитории «все» (core/broadcasts/segments). */
  segment?: Segment;
  /** Когда отправить (ISO); нет — сразу. Крон не берёт рассылку раньше срока. */
  send_at?: string;
  /** Половина аудитории A/B-теста (core/broadcasts/ab) и какой это вариант. */
  ab?: { group: string; half: 0 | 1; variant: "A" | "B" };
};
export type BroadcastChannel = "telegram" | "whatsapp";

/** Сколько рассылок канала можно запланировать наперёд. */
export const MAX_SCHEDULED = 20;
/** Крон и проверка «канал занят» смотрят столько активных: запланированные плюс идущая. */
const ACTIVE_SCAN = MAX_SCHEDULED + 5;

/** Получатель WhatsApp-рассылки: номер плюс синтетический ключ покупателя. */
export type WhatsAppRecipient = { telegramId: number; phone: string };

function phoneOf(u: { user_key: string; contact_phone: string | null }): string {
  const raw =
    u.contact_phone?.replace(/\D/g, "") ||
    (u.user_key.startsWith("wa_") ? u.user_key.slice(3) : "");
  return /^\d{10,15}$/.test(raw) ? raw : "";
}

/** Список номеров, которым продавец обещал не писать (настройка whatsapp_bot_excluded_phones). */
export function parseExcludedPhones(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[,;\n]+/)
      .map((x) => x.replace(/\D/g, ""))
      .filter((x) => x.length >= 10),
  );
}

/**
 * Кому уходит WhatsApp-рассылка: покупатели из WhatsApp с номером, без
 * отписавшихся и исключённых. «Себе на пробу» здесь нет — у продавца в базе
 * нет своей записи покупателя, пустой список честнее отправки непонятно кому.
 */
export async function resolveWhatsAppAudience(
  ctx: TenantContext,
  type: AudienceType,
  filter: AudienceFilter = {},
): Promise<WhatsAppRecipient[]> {
  if (type === "test") return [];
  const { getSetting } = await import("@/core/settings/settings");
  const excluded = parseExcludedPhones(await getSetting(ctx, "whatsapp_bot_excluded_phones"));
  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, user_key, contact_phone, state, opt_out")
        .eq("platform", "whatsapp")
        .order("user_key")
        .range(from, to),
    "получатели WhatsApp",
  );
  let buyers: Set<string> | null = null;
  if (type === "buyers" || type === "non_buyers") {
    const orders = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("user_key")
          .in("status", [...BUYER_STATUSES])
          .eq("platform", "whatsapp")
          .order("id")
          .range(from, to),
      "покупатели WhatsApp",
    );
    buyers = new Set(orders.map((o) => String(o.user_key ?? "")).filter(Boolean));
  }
  const code = filter.country_code?.trim().toUpperCase();
  return users
    .filter((u) => !u.opt_out)
    .filter((u) => (buyers ? buyers.has(u.user_key) === (type === "buyers") : true))
    .filter((u) =>
      type === "country"
        ? Boolean(code) &&
          String(
            (u.state as { country_code?: string } | null)?.country_code ?? "",
          ).toUpperCase() === code
        : true,
    )
    .map((u) => ({ telegramId: Number(u.telegram_id), phone: phoneOf(u) }))
    .filter((r) => r.phone && !excluded.has(r.phone));
}

/** Статусы заказов, по которым человек считается покупателем: оплаченный
 *  цифровой (delivered) и физический с принятым задатком в работе. */
export const BUYER_STATUSES = ["delivered", "accepted", "in_production", "ready"] as const;

/**
 * Кому уходит рассылка. Только настоящие Telegram-чаты: у покупателей из
 * Instagram/WhatsApp telegram_id синтетический (отрицательный), чата с таким
 * номером не существует.
 */
export async function resolveAudience(
  ctx: TenantContext,
  type: AudienceType,
  filter: AudienceFilter = {},
): Promise<number[]> {
  if (type === "test") {
    return (await adminRecipients(ctx)).map(Number).filter(isRealTelegramChat);
  }

  // Отписавшиеся и заблокированные не получают рассылок ни в какой аудитории,
  // в том числе «купившие»: покупатель мог купить, а потом отписаться.
  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, user_key, state, opt_out")
        .eq("platform", "telegram")
        .order("user_key")
        .range(from, to),
    "получатели рассылки",
  );
  const blocked = await blockedIds(ctx);
  const reachable = users
    .filter((u) => !u.opt_out)
    .map((u) => ({ id: Number(u.telegram_id), userKey: u.user_key, state: u.state }))
    .filter((u) => isRealTelegramChat(u.id) && !blocked.has(u.id));

  const buyers = async () => {
    const orders = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("telegram_id")
          .in("status", [...BUYER_STATUSES])
          .eq("platform", "telegram")
          .order("id")
          .range(from, to),
      "покупатели для рассылки",
    );
    return new Set(orders.map((o) => Number(o.telegram_id)).filter(isRealTelegramChat));
  };

  if (type === "buyers") {
    const b = await buyers();
    return reachable.filter((u) => b.has(u.id)).map((u) => u.id);
  }
  if (type === "non_buyers") {
    const b = await buyers();
    return reachable.filter((u) => !b.has(u.id)).map((u) => u.id);
  }
  if (type === "country") {
    const code = filter.country_code?.trim().toUpperCase();
    if (!code) return [];
    return reachable
      .filter(
        (u) =>
          String(
            (u.state as { country_code?: string } | null)?.country_code ?? "",
          ).toUpperCase() === code,
      )
      .map((u) => u.id);
  }
  const segment = parseSegment(filter.segment);
  if (segment) {
    const members = await segmentMembers(ctx, segment, reachable, BUYER_STATUSES);
    return reachable.filter((u) => members.has(u.id)).map((u) => u.id);
  }
  return reachable.map((u) => u.id);
}

async function blockedIds(ctx: TenantContext): Promise<Set<number>> {
  const rows = await pageAll(
    (from, to) =>
      ctx.db.from("blocked_users").select("telegram_id").order("telegram_id").range(from, to),
    "заблокированные покупатели",
  );
  return new Set(rows.map((r) => Number(r.telegram_id)));
}

/** Страны покупателей для фильтра аудитории: код → сколько человек. */
export async function audienceCountries(ctx: TenantContext): Promise<Record<string, number>> {
  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("state")
        .eq("platform", "telegram")
        .order("user_key")
        .range(from, to),
    "страны покупателей",
  );
  const out: Record<string, number> = {};
  for (const u of users) {
    const code = String((u.state as { country_code?: string } | null)?.country_code ?? "")
      .trim()
      .toUpperCase();
    if (code) out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

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

/** Отправитель одного сообщения; бросает Error с описанием от канала. */
export type BroadcastRecipient = { telegramId: number; phone: string | null };
export type BroadcastSender = (
  recipient: BroadcastRecipient,
  content: BroadcastContent,
  broadcast: BroadcastRow,
) => Promise<void>;

export function contentOf(b: BroadcastRow): BroadcastContent {
  return normalizeContent({
    text: b.message_text ?? "",
    photoKeys: Array.isArray(b.photo_paths) ? (b.photo_paths as string[]) : [],
    productIds: Array.isArray(b.product_ids) ? (b.product_ids as string[]) : [],
    showCatalog: Boolean(b.show_catalog),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BatchResult = {
  broadcastId: string | null;
  processed: number;
  sent: number;
  failed: number;
  blocked: number;
  done: boolean;
};

/**
 * Один пакет самой старой активной рассылки клиента. Крон зовёт это раз в
 * минуту; счётчики — атомарным инкрементом в базе, чтобы параллельный
 * запуск не терял отправленные.
 */
export async function processBroadcastBatch(
  ctx: TenantContext,
  send: BroadcastSender,
  channel: BroadcastChannel = "telegram",
): Promise<BatchResult> {
  const none: BatchResult = {
    broadcastId: null,
    processed: 0,
    sent: 0,
    failed: 0,
    blocked: 0,
    done: true,
  };
  // Запланированная рассылка ждёт своего часа: берём самую старую из тех,
  // чей срок наступил (или без срока).
  const { data: active, error: activeError } = await ctx.db
    .from("broadcasts")
    .select("*")
    .in("status", ["queued", "sending"])
    .eq("channel", channel)
    .order("created_at", { ascending: true })
    .limit(ACTIVE_SCAN);
  // Сбой чтения — не «рассылок нет»: крон падает, а не молча проходит.
  if (activeError) throw serverFailure(`Рассылки: активные: ${activeError.message}`);
  const broadcast = (active ?? []).find((b) => isDue(b, Date.now()));
  if (!broadcast) return none;

  if (broadcast.status === "queued") {
    const { error } = await ctx.db
      .from("broadcasts")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", broadcast.id)
      .eq("status", "queued");
    if (error) throw serverFailure(`Рассылки: старт: ${error.message}`);
  }

  const finish = async () => {
    const { data: fresh, error } = await ctx.db
      .from("broadcasts")
      .select("sent_count, total_count, status")
      .eq("id", broadcast.id)
      .single();
    // Не прочитали — не закрываем: следующий запуск крона закроет сам.
    if (error) throw serverFailure(`Рассылки: итог: ${error.message}`);
    if (fresh && fresh.status !== "cancelled")
      await ctx.db
        .from("broadcasts")
        .update({
          status: finalStatus(fresh.sent_count, fresh.total_count),
          completed_at: new Date().toISOString(),
        })
        .eq("id", broadcast.id)
        .in("status", ["queued", "sending"]);
  };

  // Захват получателя до отправки: строка остаётся pending, но с sent_at =
  // метка захвата. Второй запуск крона (пересёкшийся по времени) такую
  // строку не выберет и не отправит второй раз. Итог пишется CAS-ом.
  // Захваченные и брошенные упавшим запуском — недоставлены, без повтора.
  const now = Date.now();
  const { data: stale, error: staleError } = await ctx.db
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: STALE_CLAIM_ERROR, sent_at: null })
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending")
    .lt("sent_at", new Date(now - CLAIM_STALE_MS).toISOString())
    .select("id");
  if (staleError) throw serverFailure(`Рассылки: брошенные: ${staleError.message}`);

  const { data: pending, error: pendingError } = await ctx.db
    .from("broadcast_recipients")
    .select("id, telegram_id, phone")
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending")
    .is("sent_at", null)
    .limit(BATCH_SIZE);
  if (pendingError) throw serverFailure(`Рассылки: получатели: ${pendingError.message}`);

  const content = contentOf(broadcast);
  let sent = 0;
  let failed = stale?.length ?? 0;
  let blocked = 0;

  // Список получателей собран при создании; кто отписался или попал в
  // блокировку с тех пор (рассылка могла ждать по расписанию), не получает.
  const list: typeof pending = [];
  // Сбой посреди пакета: доделанное (отправлено, помечено blocked) всё равно
  // попадает в счётчики, и только потом бросаем ошибку.
  let failure: Error | null = null;
  const gone = await unreachableNow(
    ctx,
    (pending ?? []).map((r) => Number(r.telegram_id)),
    channel,
  );
  for (const r of pending ?? []) {
    if (!gone.has(Number(r.telegram_id))) {
      list.push(r);
      continue;
    }
    const { data: skipped, error: skipError } = await ctx.db
      .from("broadcast_recipients")
      .update({ status: "blocked", error_message: "отписался до отправки" })
      .eq("id", r.id)
      .eq("status", "pending")
      .is("sent_at", null)
      .select("id")
      .maybeSingle();
    if (skipError) {
      failure = serverFailure(`Рассылки: отписка до отправки: ${skipError.message}`);
      list.length = 0; // не знаем, кто ещё отписан, — отправку пакета не начинаем
      break;
    }
    if (skipped) blocked++;
  }
  for (let i = 0; i < list.length; i++) {
    const r = list[i]!;
    // Отмену из панели уважаем между сообщениями, а не по концу пакета.
    if (i > 0 && i % 10 === 0) {
      const { data: st, error: stError } = await ctx.db
        .from("broadcasts")
        .select("status")
        .eq("id", broadcast.id)
        .single();
      // Не знаем, не отменили ли рассылку, — не шлём дальше.
      if (stError || st?.status === "cancelled") break;
    }
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await ctx.db
      .from("broadcast_recipients")
      .update({ sent_at: claimedAt })
      .eq("id", r.id)
      .eq("status", "pending")
      .is("sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimError) {
      failure = serverFailure(`Рассылки: захват получателя: ${claimError.message}`);
      break;
    }
    if (!claimed) continue;
    // Итог — CAS-ом по нашей метке захвата: отмена или чужой запуск,
    // успевшие поменять строку, не будут перезаписаны и посчитаны дважды.
    const settle = async (
      patch: Database["public"]["Tables"]["broadcast_recipients"]["Update"],
    ) => {
      const { data } = await ctx.db
        .from("broadcast_recipients")
        .update(patch)
        .eq("id", r.id)
        .eq("status", "pending")
        .eq("sent_at", claimedAt)
        .select("id")
        .maybeSingle();
      return Boolean(data);
    };
    try {
      await send({ telegramId: Number(r.telegram_id), phone: r.phone ?? null }, content, broadcast);
      if (await settle({ status: "sent", sent_at: new Date().toISOString(), error_message: null }))
        sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const kind = classifyDeliveryError(message);
      if (
        await settle({
          status: kind,
          sent_at: null,
          error_message: message.slice(0, 500) || "unknown error",
        })
      ) {
        if (kind === "blocked") blocked++;
        else failed++;
      }
    }
    if (i + 1 < list.length) await sleep(SEND_DELAY_MS);
  }

  if (sent + failed + blocked > 0) {
    const { error } = await ctx.db.rpc("increment_broadcast_counts", {
      p_broadcast_id: broadcast.id,
      p_sent: sent,
      p_failed: failed,
      p_blocked: blocked,
    });
    if (error) {
      const { data: fresh, error: freshError } = await ctx.db
        .from("broadcasts")
        .select("sent_count, failed_count, blocked_count")
        .eq("id", broadcast.id)
        .single();
      // Без прочитанных счётчиков запись «0 + отправлено» затёрла бы накопленное.
      if (freshError) throw serverFailure(`Рассылки: счётчики: ${freshError.message}`);
      await ctx.db
        .from("broadcasts")
        .update({
          sent_count: (fresh?.sent_count ?? 0) + sent,
          failed_count: (fresh?.failed_count ?? 0) + failed,
          blocked_count: (fresh?.blocked_count ?? 0) + blocked,
        })
        .eq("id", broadcast.id);
    }
  }

  if (failure) throw failure;

  const { count, error: countError } = await ctx.db
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending");
  // Не сосчитали остаток — рассылку не закрываем (иначе «0 ожидающих» по сбою).
  if (countError) throw serverFailure(`Рассылки: остаток: ${countError.message}`);
  // В счёт идут и захваченные параллельным запуском: пока он шлёт,
  // рассылка не закрывается.
  const done = !count;
  if (done) await finish();
  return { broadcastId: broadcast.id, processed: list.length, sent, failed, blocked, done };
}

/** Срок рассылки наступил: без send_at — сразу. */
export function isDue(b: Pick<BroadcastRow, "audience_filter">, now: number): boolean {
  const at = (b.audience_filter as AudienceFilter | null)?.send_at;
  if (!at) return true;
  const t = Date.parse(at);
  return !Number.isFinite(t) || t <= now;
}

/** Кто из пакета сейчас отписан или заблокирован (Telegram: ещё и blocked_users). */
async function unreachableNow(
  ctx: TenantContext,
  ids: number[],
  channel: BroadcastChannel,
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const { data: optedOut, error: optError } = await ctx.db
    .from("bot_users")
    .select("telegram_id")
    .in("telegram_id", ids)
    .eq("platform", channel)
    .eq("opt_out", true);
  // Не прочитали, кто отписан, — не шлём никому из пакета.
  if (optError) throw serverFailure(`Рассылки: отписавшиеся: ${optError.message}`);
  const out = new Set((optedOut ?? []).map((u) => Number(u.telegram_id)));
  if (channel === "telegram") {
    const { data: blocked, error: blockedError } = await ctx.db
      .from("blocked_users")
      .select("telegram_id")
      .in("telegram_id", ids);
    if (blockedError) throw serverFailure(`Рассылки: блокировки: ${blockedError.message}`);
    for (const b of blocked ?? []) out.add(Number(b.telegram_id));
  }
  return out;
}

export async function cancelBroadcast(ctx: TenantContext, id: string): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("broadcasts")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["queued", "sending"])
    .select("id")
    .maybeSingle();
  if (error) throw serverFailure(`Рассылки: отмена: ${error.message}`);
  if (!data) return false;
  const rest = await ctx.db
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: "cancelled" })
    .eq("broadcast_id", id)
    .eq("status", "pending");
  if (rest.error) throw serverFailure(`Рассылки: получатели отменённой: ${rest.error.message}`);
  return true;
}

export async function listBroadcasts(ctx: TenantContext, limit = 50): Promise<BroadcastRow[]> {
  const { data, error } = await ctx.db
    .from("broadcasts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`broadcasts: ${error.message}`);
  return data ?? [];
}

export async function hasActiveBroadcast(
  ctx: TenantContext,
  channel: BroadcastChannel = "telegram",
): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("broadcasts")
    .select("id, audience_filter")
    .in("status", ["queued", "sending"])
    .eq("channel", channel)
    .limit(ACTIVE_SCAN);
  if (error) throw serverFailure(`Рассылки: активные: ${error.message}`);
  const now = Date.now();
  return (data ?? []).some((b) => isDue(b, now));
}
