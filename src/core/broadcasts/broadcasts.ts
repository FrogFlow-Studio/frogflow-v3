import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Database } from "@/core/db-types";
import { pageAll } from "@/core/db/page";
import { adminRecipients } from "@/core/notify/recipients";
import {
  AUDIENCE_TYPES,
  BATCH_SIZE,
  SEND_DELAY_MS,
  classifyDeliveryError,
  contentProblem,
  finalStatus,
  isRealTelegramChat,
  normalizeContent,
  type AudienceType,
  type BroadcastContent,
} from "./pure";

export type BroadcastRow = Database["public"]["Tables"]["broadcasts"]["Row"];
export type AudienceFilter = { country_code?: string };

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

  const buyers = async () => {
    const orders = await pageAll(
      (from, to) =>
        ctx.db
          .from("orders")
          .select("telegram_id")
          .in("status", [...BUYER_STATUSES])
          .eq("platform", "telegram")
          .range(from, to),
      "покупатели для рассылки",
    );
    return new Set(orders.map((o) => Number(o.telegram_id)).filter(isRealTelegramChat));
  };

  if (type === "buyers") return [...(await buyers())];

  const users = await pageAll(
    (from, to) =>
      ctx.db
        .from("bot_users")
        .select("telegram_id, state, opt_out")
        .eq("platform", "telegram")
        .range(from, to),
    "получатели рассылки",
  );
  const reachable = users
    .filter((u) => !u.opt_out)
    .map((u) => ({ id: Number(u.telegram_id), state: u.state }))
    .filter((u) => isRealTelegramChat(u.id));

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
  return reachable.map((u) => u.id);
}

/** Страны покупателей для фильтра аудитории: код → сколько человек. */
export async function audienceCountries(ctx: TenantContext): Promise<Record<string, number>> {
  const users = await pageAll(
    (from, to) =>
      ctx.db.from("bot_users").select("state").eq("platform", "telegram").range(from, to),
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

export type CreateBroadcastInput = BroadcastContent & {
  audience: AudienceType;
  filter?: AudienceFilter;
};

export type CreateBroadcastResult =
  | { ok: true; broadcast: BroadcastRow }
  | { ok: false; reason: "invalid" | "no_recipients" | "busy" | "db"; message: string };

export async function createBroadcast(
  ctx: TenantContext,
  input: CreateBroadcastInput,
): Promise<CreateBroadcastResult> {
  const content = normalizeContent(input);
  const problem = contentProblem(content);
  if (problem) return { ok: false, reason: "invalid", message: problem };
  if (!AUDIENCE_TYPES.includes(input.audience))
    return { ok: false, reason: "invalid", message: "Неизвестная аудитория." };

  const ids = await resolveAudience(ctx, input.audience, input.filter);
  if (ids.length === 0)
    return {
      ok: false,
      reason: "no_recipients",
      message:
        input.audience === "test"
          ? "Не настроен Telegram-id администратора (Настройки → Уведомления)."
          : "Для выбранной аудитории получателей не нашлось.",
    };

  const { data: active, error: activeError } = await ctx.db
    .from("broadcasts")
    .select("id")
    .in("status", ["queued", "sending"])
    .eq("channel", "telegram")
    .limit(1)
    .maybeSingle();
  if (activeError) return { ok: false, reason: "db", message: activeError.message };
  if (active)
    return { ok: false, reason: "busy", message: "Уже идёт другая рассылка — дождитесь её." };

  const { data: broadcast, error } = await ctx.db
    .from("broadcasts")
    .insert({
      bot_id: ctx.tenant.id,
      status: "queued",
      channel: "telegram",
      message_text: content.text,
      photo_paths: content.photoKeys,
      product_ids: content.productIds,
      show_catalog: content.showCatalog,
      audience_type: input.audience,
      audience_filter: input.filter ?? {},
      total_count: ids.length,
    })
    .select("*")
    .single();
  if (error || !broadcast)
    return { ok: false, reason: "db", message: error?.message ?? "Не удалось создать рассылку" };

  const rows = ids.map((telegram_id) => ({
    bot_id: ctx.tenant.id,
    broadcast_id: broadcast.id,
    telegram_id,
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
export type BroadcastSender = (telegramId: number, content: BroadcastContent) => Promise<void>;

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
): Promise<BatchResult> {
  const none: BatchResult = {
    broadcastId: null,
    processed: 0,
    sent: 0,
    failed: 0,
    blocked: 0,
    done: true,
  };
  const { data: broadcast } = await ctx.db
    .from("broadcasts")
    .select("*")
    .in("status", ["queued", "sending"])
    .eq("channel", "telegram")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!broadcast) return none;

  if (broadcast.status === "queued") {
    await ctx.db
      .from("broadcasts")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("id", broadcast.id)
      .eq("status", "queued");
  }

  const { data: pending } = await ctx.db
    .from("broadcast_recipients")
    .select("id, telegram_id")
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending")
    .limit(BATCH_SIZE);

  const finish = async () => {
    const { data: fresh } = await ctx.db
      .from("broadcasts")
      .select("sent_count, total_count, status")
      .eq("id", broadcast.id)
      .single();
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

  if (!pending?.length) {
    await finish();
    return { ...none, broadcastId: broadcast.id };
  }

  const content = contentOf(broadcast);
  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (let i = 0; i < pending.length; i++) {
    const r = pending[i]!;
    // Отмену из панели уважаем между сообщениями, а не по концу пакета.
    if (i > 0 && i % 10 === 0) {
      const { data: st } = await ctx.db
        .from("broadcasts")
        .select("status")
        .eq("id", broadcast.id)
        .single();
      if (st?.status === "cancelled") break;
    }
    // Итог пишем CAS-ом «ещё pending»: два пересёкшихся запуска крона (или
    // живой деплой v1 на той же очереди) не посчитают одного получателя дважды.
    const settle = async (
      patch: Database["public"]["Tables"]["broadcast_recipients"]["Update"],
    ) => {
      const { data } = await ctx.db
        .from("broadcast_recipients")
        .update(patch)
        .eq("id", r.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      return Boolean(data);
    };
    try {
      await send(Number(r.telegram_id), content);
      if (await settle({ status: "sent", sent_at: new Date().toISOString(), error_message: null }))
        sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const kind = classifyDeliveryError(message);
      if (await settle({ status: kind, error_message: message.slice(0, 500) || "unknown error" })) {
        if (kind === "blocked") blocked++;
        else failed++;
      }
    }
    if (i + 1 < pending.length) await sleep(SEND_DELAY_MS);
  }

  if (sent + failed + blocked > 0) {
    const { error } = await ctx.db.rpc("increment_broadcast_counts", {
      p_broadcast_id: broadcast.id,
      p_sent: sent,
      p_failed: failed,
      p_blocked: blocked,
    });
    if (error) {
      const { data: fresh } = await ctx.db
        .from("broadcasts")
        .select("sent_count, failed_count, blocked_count")
        .eq("id", broadcast.id)
        .single();
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

  const { count } = await ctx.db
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcast.id)
    .eq("status", "pending");
  const done = !count;
  if (done) await finish();
  return { broadcastId: broadcast.id, processed: pending.length, sent, failed, blocked, done };
}

export async function cancelBroadcast(ctx: TenantContext, id: string): Promise<boolean> {
  const { data } = await ctx.db
    .from("broadcasts")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["queued", "sending"])
    .select("id")
    .maybeSingle();
  if (!data) return false;
  await ctx.db
    .from("broadcast_recipients")
    .update({ status: "failed", error_message: "cancelled" })
    .eq("broadcast_id", id)
    .eq("status", "pending");
  return true;
}

export async function listBroadcasts(ctx: TenantContext, limit = 50): Promise<BroadcastRow[]> {
  const { data, error } = await ctx.db
    .from("broadcasts")
    .select("*")
    .eq("channel", "telegram")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`broadcasts: ${error.message}`);
  return data ?? [];
}

export async function hasActiveBroadcast(ctx: TenantContext): Promise<boolean> {
  const { data } = await ctx.db
    .from("broadcasts")
    .select("id")
    .in("status", ["queued", "sending"])
    .eq("channel", "telegram")
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}
