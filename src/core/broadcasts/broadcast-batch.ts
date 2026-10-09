import { serverFailure } from "@/lib/server-failure";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { isLocale } from "@/core/i18n/locale";
import type { Database } from "@/core/db-types";
import {
  BATCH_SIZE,
  CLAIM_STALE_MS,
  SEND_DELAY_MS,
  STALE_CLAIM_ERROR,
  classifyDeliveryError,
  finalStatus,
  normalizeContent,
  type BroadcastContent,
} from "./pure";
import { parseSegment } from "./segments";
import { claimMarketing, loadMarketingCap } from "@/core/marketing/cap";
import {
  ACTIVE_SCAN,
  type AudienceFilter,
  type BroadcastChannel,
  type BroadcastRow,
} from "./broadcast-model";

/** Отправка рассылки пакетами. */

/** Отправитель одного сообщения; бросает Error с описанием от канала. */
export type BroadcastRecipient = { telegramId: number; phone: string | null };

export type BroadcastSender = (
  recipient: BroadcastRecipient,
  content: BroadcastContent,
  broadcast: BroadcastRow,
) => Promise<void>;

/** Текст рассылки для покупателя: на его языке, если продавец дал такой, иначе общий. */
export function textForLocale(
  b: Pick<BroadcastRow, "message_text" | "audience_filter">,
  locale: string | null | undefined,
): string {
  const texts = (b.audience_filter as AudienceFilter | null)?.texts;
  const own = isLocale(locale) ? texts?.[locale] : undefined;
  return own?.trim() ? own : (b.message_text ?? "");
}

export function contentOf(b: BroadcastRow): BroadcastContent {
  return normalizeContent({
    text: b.message_text ?? "",
    photoKeys: Array.isArray(b.photo_paths) ? (b.photo_paths as string[]) : [],
    productIds: Array.isArray(b.product_ids) ? (b.product_ids as string[]) : [],
    showCatalog: Boolean(b.show_catalog),
    giveawayId: (b.audience_filter as AudienceFilter | null)?.giveaway_id ?? null,
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
  const followup =
    parseSegment((broadcast.audience_filter as AudienceFilter | null)?.segment)?.kind ===
    "broadcast";
  const cap = followup ? await loadMarketingCap(ctx) : 0;
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
    if (followup) {
      // Второе касание делит потолок маркетинга с автосообщениями: место
      // занимается условной записью ДО отправки, шлёт только выигравший.
      const { data: u, error: uError } = await ctx.db
        .from("bot_users")
        .select("user_key, state")
        .eq("telegram_id", Number(r.telegram_id))
        .eq("platform", channel)
        .order("user_key")
        .limit(1)
        .maybeSingle();
      if (uError) {
        failure = serverFailure(`Рассылки: покупатель для потолка: ${uError.message}`);
        break;
      }
      const place = u ? await claimMarketing(ctx, u.user_key, u.state, cap, new Date()) : null;
      if (!place) {
        if (
          await settle({
            status: "blocked",
            sent_at: null,
            error_message: "потолок сообщений в сутки",
          })
        )
          blocked++;
        continue;
      }
    }
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
