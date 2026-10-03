import type { TenantContext } from "@/core/tenant/resolve.server";
import { serviceDb } from "@/core/db/client.server";
import { recordPayment } from "@/core/fulfillment/fulfillment";
import { claimOrderEvent, recordOrderEvent } from "./events";
import { validateProofFile } from "./proof-file";
import { proofHashes } from "./proof-hash";
import { serverFailure } from "@/lib/server-failure";

/**
 * Остаток по задатку: покупатель внёс задаток, заказ в работе, и он сам
 * доплачивает остальное — картой (Robokassa) или переводом с чеком. Сумма —
 * только с сервера: total − paid_amount. Двойной оплаты не бывает: пока чек
 * на остаток у продавца, ни карта, ни второй чек не принимаются; платёж
 * картой пишется через recordPayment, который переплату не записывает.
 */
export const BALANCE_STATUSES = ["accepted", "in_production", "ready"] as const;

/**
 * InvId Robokassa для остатка: у основного платежа InvId — номер заказа, у
 * остатка — BASE + номер заказа × 10 000 + номер выданной ссылки (свой на
 * каждую ссылку, claimBalanceInvId). Меньше 2^53 — точно в JS и
 * в Robokassa (InvId до 2^63).
 */
export const RK_BALANCE_BASE = 1_000_000_000_000_000;
const RK_ATTEMPTS = 10_000;

export type BalanceOrder = {
  status: string;
  fulfillment_kind: string;
  total: number | string;
  paid_amount: number | string | null;
};

/** Сколько осталось доплатить; 0 — доплачивать нечего или ещё рано. */
export function balanceDue(o: BalanceOrder): number {
  if (o.fulfillment_kind !== "physical") return 0;
  if (!(BALANCE_STATUSES as readonly string[]).includes(o.status)) return 0;
  const paid = Number(o.paid_amount) || 0;
  // Без задатка (оплата при получении) остаток не «доплачивается» — платят при выдаче.
  if (!(paid > 0)) return 0;
  const left = Math.round((Number(o.total) - paid) * 100) / 100;
  return left > 0.01 ? left : 0;
}

export function balanceInvId(orderId: number, attempt: number): number {
  if (!(attempt >= 0 && attempt < RK_ATTEMPTS)) throw new RangeError(`попытка ${attempt}`);
  return RK_BALANCE_BASE + orderId * RK_ATTEMPTS + attempt;
}

/** InvId из колбэка Robokassa: номер заказа и остаток ли это. */
export function parseRobokassaInvId(raw: string): { orderId: number; balance: boolean } | null {
  if (!/^\d{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  if (n < RK_BALANCE_BASE) return { orderId: n, balance: false };
  const orderId = Math.floor((n - RK_BALANCE_BASE) / RK_ATTEMPTS);
  return orderId > 0 ? { orderId, balance: true } : null;
}

/**
 * Номер счёта на одну выданную ссылку оплаты остатка. Номер захватывается
 * событием заказа (уникальный event_id), поэтому две открытые ссылки —
 * два разных InvId, и оплата по второй не гасится как «повтор» первой.
 */
export async function claimBalanceInvId(
  ctx: TenantContext,
  orderId: number,
  amount: number,
): Promise<number> {
  let n = await countEvents(ctx, `order:${orderId}:balance_link:%`);
  for (let tries = 0; tries < 5 && n < RK_ATTEMPTS; tries++, n++) {
    const invId = balanceInvId(orderId, n);
    if (
      await claimOrderEvent(ctx, orderId, "balance_link", String(n), { amount, invId }, "customer")
    )
      return invId;
  }
  throw serverFailure(`[balance] номер счёта на остаток по заказу ${orderId} не выдан`);
}

async function countEvents(ctx: TenantContext, pattern: string): Promise<number> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .like("event_id", pattern)
    .limit(RK_ATTEMPTS);
  if (error) throw serverFailure(`[balance] журнал заказа: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Место чека на остаток: внесённая сумма и сколько чеков при ней продавец
 * уже отклонил. После новой оплаты или отказа — новое место, и покупатель
 * снова может прислать чек или заплатить картой.
 */
async function proofSlot(
  ctx: TenantContext,
  orderId: number,
  paid: number | string | null,
): Promise<string> {
  const paidKey = String(Math.round((Number(paid) || 0) * 100));
  const rejected = await countEvents(ctx, `order:${orderId}:balance_proof_rejected:${paidKey}:%`);
  return `${paidKey}:${rejected}`;
}

async function hasEvent(ctx: TenantContext, eventId: string): Promise<boolean> {
  const { data, error } = await ctx.db
    .from("zernio_logs")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  // Сбой чтения — не «метки нет»: иначе чек на остаток пропадёт из очереди продавца.
  if (error) throw serverFailure(`[balance] метка ${eventId} не прочитана: ${error.message}`);
  return data != null;
}

/** Чек на остаток ждёт продавца (прислан после последней оплаты и не отклонён). */
export async function balanceProofPending(
  ctx: TenantContext,
  orderId: number,
  paid: number | string | null,
): Promise<boolean> {
  const slot = await proofSlot(ctx, orderId, paid);
  return hasEvent(ctx, `order:${orderId}:balance_proof:${slot}`);
}

/**
 * Продавец не принял чек на остаток: ожидание снято, покупатель снова может
 * заплатить картой или прислать другой чек. false — ждущего чека нет
 * (уже отклонён, оплата уже внесена или чека не было).
 */
export async function rejectBalanceProof(
  ctx: TenantContext,
  orderId: number,
  actor: string,
): Promise<boolean> {
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("paid_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw serverFailure(`[balance] заказ ${orderId}: ${error.message}`);
  if (!order) return false;
  const slot = await proofSlot(ctx, orderId, order.paid_amount);
  if (!(await hasEvent(ctx, `order:${orderId}:balance_proof:${slot}`))) return false;
  return claimOrderEvent(ctx, orderId, "balance_proof_rejected", slot, {}, actor);
}

/** Сколько покупатель может доплатить сейчас: остаток, если чек на него не ждёт проверки. */
export async function balancePayable(
  ctx: TenantContext,
  order: BalanceOrder & { id: number },
): Promise<number> {
  const due = balanceDue(order);
  if (!due) return 0;
  return (await balanceProofPending(ctx, order.id, order.paid_amount)) ? 0 : due;
}

export type BalanceProofResult =
  | { ok: true; due: number; path: string }
  | { ok: false; reason: "invalid_file" | "file_too_large" | "duplicate" | "upload_failed" };

/**
 * Чек на остаток: файл — в бакет чеков рядом с чеком задатка, запись —
 * событием заказа (колонки чека заняты задатком, схема не меняется). Одно
 * событие на внесённую сумму: второй чек до решения продавца не принимается.
 * null — у заказа нет остатка к доплате (обычный чек идёт своим путём).
 */
export async function attachBalanceProof(
  ctx: TenantContext,
  order: BalanceOrder & { id: number },
  file: { bytes: Uint8Array; mime: string },
): Promise<BalanceProofResult | null> {
  const due = balanceDue(order);
  if (!due) return null;
  const checked = validateProofFile(file);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  if (await balanceProofPending(ctx, order.id, order.paid_amount))
    return { ok: false, reason: "duplicate" };
  const hashes = proofHashes(file.bytes);
  // Тот же файл уже был чеком — задатка этого или другого заказа, или остатка.
  const [{ data: dupOrder }, { data: dupBalance }] = await Promise.all([
    ctx.db.from("orders").select("id").in("payment_proof_hash", hashes.all).limit(1).maybeSingle(),
    ctx.db
      .from("zernio_logs")
      .select("id")
      .eq("event_type", "order.balance_proof")
      .in("payload->>hash", hashes.all)
      .limit(1)
      .maybeSingle(),
  ]);
  if (dupOrder || dupBalance) return { ok: false, reason: "duplicate" };

  const path = `${ctx.tenant.id}/order-${order.id}/balance-${Date.now()}.${checked.ext}`;
  const up = await serviceDb()
    .storage.from("payment-proofs")
    .upload(path, new Blob([file.bytes as BlobPart], { type: checked.mime }), {
      contentType: checked.mime,
      upsert: true,
    });
  if (up.error) {
    console.error("[balance] чек не загружен", up.error);
    return { ok: false, reason: "upload_failed" };
  }
  const slot = await proofSlot(ctx, order.id, order.paid_amount);
  const slotId = `order:${order.id}:balance_proof:${slot}`;
  const claimed = await claimOrderEvent(
    ctx,
    order.id,
    "balance_proof",
    slot,
    { path, amount: due, hash: hashes.stored },
    "customer",
  );
  if (!claimed) {
    await serviceDb().storage.from("payment-proofs").remove([path]);
    return { ok: false, reason: "duplicate" };
  }
  // Остаток оплатили картой, пока чек загружался: чек не нужен — снимаем
  // его, покупатель видит, что заказ уже оплачен.
  const { data: now, error: nowError } = await ctx.db
    .from("orders")
    .select("paid_amount")
    .eq("id", order.id)
    .maybeSingle();
  // Не прочиталось — чек остаётся у продавца: лишний чек безвреден, потерянный — нет.
  if (nowError)
    console.error(`[balance] оплата заказа ${order.id} не перечитана: ${nowError.message}`);
  if (now && Number(now.paid_amount) !== Number(order.paid_amount)) {
    await ctx.db
      .from("zernio_logs")
      .update({ event_id: `${slotId}:released:${Date.now()}`, status: "ignored" })
      .eq("event_id", slotId);
    await serviceDb().storage.from("payment-proofs").remove([path]);
    return null;
  }
  return { ok: true, due, path };
}

/** Последний чек на остаток (путь в бакете) — продавцу в карточку заказа. */
export function lastBalanceProofPath(
  events: Array<{ kind: string; payload: Record<string, unknown> }>,
): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === "balance_proof" && typeof e.payload.path === "string") return e.payload.path;
  }
  return null;
}

export type BalancePaidResult = {
  result: "recorded" | "duplicate" | "refused" | "closed" | "not_found" | "retry";
  /** Чек на остаток ждал продавца, когда пришла оплата картой: его не вносить. */
  proofPending?: boolean;
};

/**
 * Остаток оплачен онлайн (колбэк шлюза с верной подписью). Повтор того же
 * колбэка — `duplicate`, ничего не пишем; `retry` — записать не удалось
 * (сбой базы), метка снята, шлюз должен повторить. `refused` — деньги
 * пришли, но остаток уже внесён (переплата); `closed` — заказ отменён или
 * отклонён. В обоих случаях решает продавец.
 */
export async function recordBalancePaidOnline(
  ctx: TenantContext,
  orderId: number,
  amount: number,
  provider: string,
  ref: string,
): Promise<BalancePaidResult> {
  const { data: order, error } = await ctx.db
    .from("orders")
    .select("id, currency, status, paid_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (error) return { result: "retry" };
  if (!order) return { result: "not_found" };
  // Номер счёта (InvId) — в каждом событии: продавцу искать платёж в кабинете шлюза.
  const payload = { amount, currency: order.currency, source: "balance", provider, invId: ref };
  const actor = provider.toLowerCase();
  const key = `${actor}:${ref}:${amount.toFixed(2)}`;
  const eventId = `order:${orderId}:balance_paid:${key}`;
  if (!(await claimOrderEvent(ctx, orderId, "balance_paid", key, payload, actor))) {
    // Метки нет — это сбой записи, а не повтор: пусть шлюз пришлёт колбэк снова.
    const { data: seen, error: seenError } = await ctx.db
      .from("zernio_logs")
      .select("id")
      .eq("event_id", eventId)
      .maybeSingle();
    return { result: seen && !seenError ? "duplicate" : "retry" };
  }
  if (order.status === "cancelled" || order.status === "rejected") {
    await recordOrderEvent(ctx, orderId, "balance_closed", payload, actor);
    return { result: "closed" };
  }
  if (await recordPayment(ctx, orderId, amount)) {
    // balance_paid — только «платёж пришёл» (захват колбэка); «внесено в
    // оплату заказа» — отдельным событием после записи.
    await recordOrderEvent(ctx, orderId, "balance_credited", payload, actor);
    // Чек на остаток, присланный до этой оплаты, — после записи: чек, что
    // придёт позже, сам увидит новую сумму и снимется (attachBalanceProof).
    const proofPending = await balanceProofPending(ctx, orderId, order.paid_amount).catch(
      () => false,
    );
    return { result: "recorded", proofPending };
  }
  // recordPayment отказывает и при переплате, и при сбое (нет ответа, CAS не
  // сошёлся). Переплата — только если сумма и правда больше итога.
  const { data: now, error: overError } = await ctx.db
    .from("orders")
    .select("paid_amount, total")
    .eq("id", orderId)
    .maybeSingle();
  // Не прочиталось — переплату не объявляем, идём в «повторить».
  if (overError) console.error(`[balance] заказ ${orderId} не перечитан: ${overError.message}`);
  if (
    now &&
    Math.round(((Number(now.paid_amount) || 0) + amount) * 100) / 100 > Number(now.total) + 0.01
  ) {
    await recordOrderEvent(ctx, orderId, "balance_overpaid", payload, actor);
    return { result: "refused" };
  }
  // Временный сбой: метку снимаем (переименованием — роль арендатора
  // обновляет журнал), повтор колбэка запишет оплату.
  const { error: relError } = await ctx.db
    .from("zernio_logs")
    .update({ event_id: `${eventId}:released:${Date.now()}`, status: "ignored" })
    .eq("event_id", eventId);
  if (relError) console.error(`[balance] метка оплаты ${eventId} не снята: ${relError.message}`);
  return { result: "retry" };
}
