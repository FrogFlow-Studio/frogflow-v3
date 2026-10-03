import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { UserError } from "@/core/i18n/user-error";
import {
  activateSubscription,
  vipSettings,
  type SubscriptionWithTariff,
  type VipGroup,
} from "./vip";

/**
 * Автопроверка чека за VIP-подписку (DID 02, Развивашка): тот же разбор, что
 * у заказов (core/receipts/verify.server), с тем же лимитом попыток (#138) и
 * правилами после #241 — в той же валюте недоплата не принимается, в счёт
 * идут только суммы с ₸ или с подписью «Сумма/Итого». Сошлось — подписка
 * продлевается сама; сомнение — кнопки продавцу, как раньше.
 *
 * Включает продавец (vip_auto_confirm), по умолчанию выключено: после
 * переезда VIP работает как в v1. Нужен и модуль автопроверки чеков
 * (receiptOcrAutoEnabled: тариф, Vision платформы, лимит месяца).
 *
 * Один чек — одна подписка: каждый присланный чек (и тот, что потом
 * подтвердил продавец руками) занимает строку app_settings
 * `vip_proof:<sha256>` → id заявки (вставка, повтор — 23505). Автопроверка
 * заявки, чей файл уже занят другой, уходит продавцу; заказы магазина
 * смотрят эти же строки (verifyReceipt), а VIP — отпечатки заказов.
 * Чеки времён прежней платформы отпечатков не имеют: их отсекает дата — чек
 * без даты или старше заявки идёт продавцу.
 */
export const VIP_PROOF_PREFIX = "vip_proof:";

export type VipAutoCheck =
  | { status: "off" }
  | {
      status: "confirmed";
      amount: number;
      currency: string;
      /** Номер платежа из чека, если нашёлся. */
      paymentNo: string | null;
      /** Продление (участник уже в группе или подписка ещё идёт), а не первый вход. */
      renewed: boolean;
      deliveryFailed: boolean;
    }
  | { status: "manual"; reason: string };

const MONTHS: Record<string, number> = {
  январ: 1,
  феврал: 2,
  март: 3,
  апрел: 4,
  ма: 5,
  июн: 6,
  июл: 7,
  август: 8,
  сентябр: 9,
  октябр: 10,
  ноябр: 11,
  декабр: 12,
};

/**
 * Даты платежа в тексте чека, «ГГГГ-ММ-ДД»: «27.09.2026», «27.09.26 14:35»,
 * «27 сентября 2026». Без года дата не берётся — не с чем сравнить.
 */
export function receiptDates(text: string): string[] {
  const out = new Set<string>();
  const add = (d: number, m: number, y: number) => {
    const year = y < 100 ? 2000 + y : y;
    if (d < 1 || d > 31 || m < 1 || m > 12 || year < 2015 || year > 2100) return;
    out.add(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  };
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/g))
    add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s+([а-яё]+)\s+(\d{4})(?!\d)/gi)) {
    const word = m[2]!.toLowerCase();
    const key = Object.keys(MONTHS)
      .filter((k) => word.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key) add(Number(m[1]), MONTHS[key]!, Number(m[3]));
  }
  return [...out];
}

/** Номер платежа из чека: «№ квитанции», «Номер чека», «ID транзакции». */
export function receiptPaymentNo(text: string): string | null {
  const m = text.match(
    /(?:№\s*(?:квитанции|чека|операции|транзакции)|номер\s+(?:квитанции|чека|операции|транзакции)|id\s+транзакции|квитанция\s*№)\s*[:№]?\s*([A-Za-zА-Яа-я0-9-]{4,40})/i,
  );
  return m ? m[1]! : null;
}

/**
 * Чек не старше заявки: хоть одна дата в чеке — не раньше дня заявки минус
 * сутки (оплатил и только потом выбрал тариф). Дат нет — решает продавец.
 */
export function receiptDateProblem(text: string, subCreatedAt: string, tz: string): string | null {
  const dates = receiptDates(text);
  if (dates.length === 0) return "В чеке не нашлась дата платежа.";
  const created = new Date(subCreatedAt);
  if (Number.isNaN(created.getTime())) return null;
  const from = new Date(created.getTime() - 86_400_000).toLocaleDateString("sv-SE", {
    timeZone: tz,
  });
  if (dates.some((d) => d >= from)) return null;
  return `Чек от ${dates.sort().at(-1)!.split("-").reverse().join(".")} — раньше заявки: возможно, прошлый платёж.`;
}

/** Занять отпечаток присланного чека за заявкой — при любом чеке, до решения. */
export async function markVipProof(
  ctx: TenantContext,
  subscriptionId: string,
  bytes: Uint8Array,
): Promise<void> {
  const { proofHashes } = await import("@/core/orders/proof-hash");
  const { error } = await ctx.db.from("app_settings").insert({
    bot_id: ctx.tenant.id,
    key: `${VIP_PROOF_PREFIX}${proofHashes(bytes).stored}`,
    value: subscriptionId,
    updated_at: new Date().toISOString(),
  });
  if (error && error.code !== "23505")
    console.error(`[vip:${ctx.tenant.id}] отпечаток чека не записан: ${error.message}`);
}

/** Номер «заказа» для счётчика попыток и сверки повторов: у подписки uuid, у заказов — положительные id. */
export function vipCheckId(subscriptionId: string): number {
  return -(parseInt(subscriptionId.replace(/-/g, "").slice(0, 12), 16) || 1);
}

export async function vipAutoConfirmEnabled(ctx: TenantContext): Promise<boolean> {
  if (!(await vipSettings(ctx)).autoConfirm) return false;
  const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
  return receiptOcrAutoEnabled(ctx);
}

export async function autoCheckVipProof(
  ctx: TenantContext,
  group: VipGroup,
  sub: SubscriptionWithTariff,
  file: { bytes: Uint8Array; mime: string },
): Promise<VipAutoCheck> {
  if (!(await vipAutoConfirmEnabled(ctx))) return { status: "off" };
  const tariff = sub.vip_tariffs;
  const price = Number(tariff?.price);
  if (!tariff || !(price > 0)) return { status: "manual", reason: "У заявки нет тарифа с ценой." };

  const { verifyCustomerReceipt } = await import("@/core/receipts/verify.server");
  // Счётчик попыток — на участника VIP, как у покупателя магазина.
  const member = { userKey: `vip:${sub.telegram_id}` } as Customer;
  const { result: v } = await verifyCustomerReceipt(ctx, member, {
    bytes: file.bytes,
    mime: file.mime,
    expectedAmount: price,
    currency: tariff.currency,
    orderId: vipCheckId(sub.id),
    ageCheck: false, // дату сверяем ниже с заявкой (receiptDateProblem)
  });
  if (!v.ok) return { status: "manual", reason: v.detail };

  const extracted = v.extractedText ?? "";
  const stale = receiptDateProblem(extracted, sub.created_at, ctx.timezone);
  if (stale) return { status: "manual", reason: stale };

  const { proofHashes } = await import("@/core/orders/proof-hash");
  const { all } = proofHashes(file.bytes);
  // Отпечаток занят этой заявкой при приёме чека (markVipProof); занят другой — повтор.
  await markVipProof(ctx, sub.id, file.bytes);
  const { data: seen, error: seenError } = await ctx.db
    .from("app_settings")
    .select("value")
    .in(
      "key",
      all.map((h) => `${VIP_PROOF_PREFIX}${h}`),
    );
  if (seenError) return { status: "manual", reason: "Не удалось сверить чек с прошлыми заявками." };
  if ((seen ?? []).some((r) => r.value !== sub.id))
    return { status: "manual", reason: "Этот же чек уже был принят по другой заявке VIP." };

  try {
    const r = await activateSubscription(ctx, group, sub.id);
    const amount = v.matchedAmount ?? price;
    const currency = v.matchedCurrency ?? tariff.currency;
    const paymentNo = receiptPaymentNo(extracted);
    // Журнал: деньги видны с суммой и номером, и что подтвердил не человек.
    const { error } = await ctx.db.from("zernio_logs").insert({
      bot_id: ctx.tenant.id,
      event_id: `vip:${sub.id}:auto_confirmed`,
      event_type: "vip.auto_confirmed",
      status: "event",
      payload: {
        subscription_id: sub.id,
        telegram_id: sub.telegram_id,
        tariff: tariff.name,
        amount,
        currency,
        payment_no: paymentNo,
        renewed: r.renewed,
        note: "подтверждено автоматически",
      },
    });
    if (error) console.error(`[vip:${ctx.tenant.id}] журнал автопроверки: ${error.message}`);
    return {
      status: "confirmed",
      amount,
      currency,
      paymentNo,
      renewed: r.renewed,
      deliveryFailed: r.deliveryFailed,
    };
  } catch (e) {
    return {
      status: "manual",
      reason: `Чек сошёлся, но подписка не продлилась: ${e instanceof UserError ? e.message : String(e)}`,
    };
  }
}
