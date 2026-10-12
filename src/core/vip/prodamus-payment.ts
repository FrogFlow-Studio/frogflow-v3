import type { TenantContext } from "@/core/tenant/resolve.server";
import type { ProdamusConfig } from "@/core/payments/prodamus";
import { UserError } from "@/core/i18n/user-error";
import { adminRecipients } from "@/core/notify/recipients";
import { activateSubscription } from "./subscription-payment";
import { getSubscription } from "./subscription-queries";
import { esc, type TariffRow, type VipGroup } from "./vip-model";

/**
 * Оплата VIP-подписки через Продамус: кнопка «Картой РФ» под реквизитами
 * тарифа ведёт на форму продавца с order_id = vipChargeRef (заявка и сумма
 * под нашей подписью), уведомление приходит на тот же /api/prodamus/<bot_id>,
 * что у заказов. Успешная оплата — та же activateSubscription, что у
 * подтверждения чека: подписка открывается или продлевается, покупателю
 * ссылка в группу, продавцу сведение с суммой и номером платежа. Чек по
 * реквизитам остаётся как был.
 *
 * «Один раз»: событие `vip:<заявка>:prodamus:<платёж>` в zernio_logs
 * занимается вставкой до активации, повтор уведомления (23505) ничего не
 * делает. Деньги, которые не открыли подписку (сумма не та, заявка уже
 * закрыта или не найдена), уходят продавцу сообщением и остаются в журнале.
 */

/** Ссылка на форму Продамуса за тариф заявки; null — касса эту валюту не примет. */
export async function vipProdamusLink(
  ctx: TenantContext,
  cfg: ProdamusConfig,
  p: {
    subscriptionId: string;
    tariff: Pick<TariffRow, "name" | "price" | "currency">;
    back: string;
  },
): Promise<{ url: string; amount: number; currency: string } | null> {
  const { buildProdamusLink, prodamusCharge, vipChargeRef } =
    await import("@/core/payments/prodamus");
  const charge = prodamusCharge(cfg, Number(p.tariff.price), p.tariff.currency);
  if (!charge || !(charge.amount > 0)) return null;
  const url = buildProdamusLink(cfg, {
    amount: charge.amount,
    orderId: 0,
    ref: vipChargeRef(cfg, p.subscriptionId, charge),
    sku: `vip-${p.subscriptionId.slice(0, 8)}`,
    description: `VIP: ${p.tariff.name}`,
    notifyUrl: `${ctx.appUrl}/api/prodamus/${ctx.tenant.id}`,
    successUrl: p.back,
    returnUrl: p.back,
  });
  return { url, ...charge };
}

export type VipProdamusOutcome =
  | "vip_paid"
  | "vip_already_done"
  | "vip_not_found"
  | "vip_sum_mismatch"
  | "vip_not_pending"
  | "vip_activate_failed";

/** Успешное уведомление Продамуса по заявке VIP (подпись и статус уже проверены). */
export async function applyVipProdamusPayment(
  ctx: TenantContext,
  cfg: ProdamusConfig,
  group: VipGroup,
  ref: { subscriptionId: string; amount: number; currency: string },
  n: Record<string, unknown>,
): Promise<VipProdamusOutcome> {
  const paymentNo = String(n.order_id ?? "").slice(0, 80);
  const paid = `${String(n.sum ?? ref.amount)} ${ref.currency}`;
  const card = String(n.currency ?? "").toUpperCase();
  const cardNote = card && card !== ref.currency ? `, картой ${card}` : "";

  const eventId = `vip:${ref.subscriptionId}:prodamus:${paymentNo || ref.amount}`;
  const claimed = await ctx.db.from("zernio_logs").insert({
    bot_id: ctx.tenant.id,
    event_id: eventId,
    event_type: "vip.prodamus_paid",
    status: "event",
    payload: {
      subscription_id: ref.subscriptionId,
      amount: ref.amount,
      currency: ref.currency,
      sum: String(n.sum ?? ""),
      card_currency: card || null,
      payment_no: paymentNo || null,
    },
  });
  if (claimed.error?.code === "23505") return "vip_already_done";
  // Журнал не записался — не повод терять оплату: идём дальше, сбой в логах.
  if (claimed.error)
    console.error(`[vip:${ctx.tenant.id}] журнал оплаты Продамусом: ${claimed.error.message}`);

  const money = `Сумма: <b>${esc(paid)}</b>${esc(cardNote)}${paymentNo ? `, платёж Продамуса № ${esc(paymentNo)}` : ""}`;
  const sub = await getSubscription(ctx, ref.subscriptionId);
  if (!sub) {
    await tellSellers(
      ctx,
      group,
      `⚠️ <b>Оплата VIP через Продамус без заявки</b>\n\n${money}\n\nЗаявка не найдена (удалена?). Проверьте платёж в кабинете Продамуса и при необходимости добавьте участника вручную в разделе VIP.`,
    );
    return "vip_not_found";
  }
  const who = buyer(sub);
  const tariff = sub.vip_tariffs;
  if (sub.status !== "pending_payment") {
    await tellSellers(
      ctx,
      group,
      `⚠️ <b>Оплата VIP через Продамус по закрытой заявке</b>\n\n${who}\nТариф: <b>${esc(tariff?.name ?? "—")}</b>\n${money}\n\nЗаявка уже «${esc(statusName(sub.status))}» — подписка сама не продлилась. Продлите её в разделе VIP или верните деньги.`,
    );
    return "vip_not_pending";
  }
  const { prodamusCharge } = await import("@/core/payments/prodamus");
  const due = tariff ? prodamusCharge(cfg, Number(tariff.price), tariff.currency) : null;
  // Покупатель сменил тариф после ссылки: оплачена прежняя сумма — решает продавец.
  if (!due || Math.abs(due.amount - ref.amount) > 0.005) {
    await tellSellers(
      ctx,
      group,
      `⚠️ <b>Оплата VIP через Продамус: сумма не по тарифу</b>\n\n${who}\nТариф заявки: <b>${esc(tariff?.name ?? "—")}</b>${due ? ` (${due.amount} ${due.currency})` : ""}\n${money}\n\nПодписка сама не открылась — подтвердите или отклоните заявку в разделе VIP.`,
    );
    return "vip_sum_mismatch";
  }
  try {
    const r = await activateSubscription(ctx, group, sub.id);
    const head = r.renewed
      ? "✅ <b>VIP-подписка продлена — оплата через Продамус</b>"
      : "✅ <b>VIP-подписка оформлена — оплата через Продамус</b>, участнику отправлена ссылка в группу";
    await tellSellers(
      ctx,
      group,
      `${head}\n\n${who}\nТариф: <b>${esc(tariff?.name ?? "")}</b>\n${money}${r.deliveryFailed ? "\n\n⚠️ Ссылку не удалось отправить пользователю. Используйте «Переотправить» в разделе VIP панели." : ""}`,
    );
    return "vip_paid";
  } catch (e) {
    // Сбой базы или сети — снять отметку и отдать ошибку: Продамус повторит уведомление.
    if (!(e instanceof UserError)) {
      if (!claimed.error)
        await ctx.db
          .from("zernio_logs")
          .delete()
          .eq("bot_id", ctx.tenant.id)
          .eq("event_id", eventId);
      throw e;
    }
    // Заявку в ту же секунду подтвердил продавец по чеку — деньги пришли дважды.
    const reason = e.message;
    await tellSellers(
      ctx,
      group,
      `⚠️ <b>Оплата VIP через Продамус пришла, но подписка не открылась</b>\n\n${who}\nТариф: <b>${esc(tariff?.name ?? "")}</b>\n${money}\n\nПричина: ${esc(reason)}`,
    );
    return "vip_activate_failed";
  }
}

function buyer(sub: {
  telegram_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
}): string {
  const name =
    [sub.first_name, sub.last_name].filter(Boolean).join(" ").trim() ||
    (sub.username ? `@${sub.username}` : "");
  const label = name ? `${esc(name)} (ID ${sub.telegram_id})` : `ID ${sub.telegram_id}`;
  return `Пользователь: <a href="tg://user?id=${sub.telegram_id}">${label}</a>`;
}

function statusName(status: string): string {
  return { active: "активна", expired: "истекла", cancelled: "отклонена" }[status] ?? status;
}

async function tellSellers(ctx: TenantContext, group: VipGroup, html: string): Promise<void> {
  const admins = await adminRecipients(ctx);
  if (admins.length === 0)
    console.warn(`[vip:${ctx.tenant.id}] оплата Продамусом: некому сообщить — admin_chat_id пуст`);
  for (const id of admins) await group.send(Number(id), html);
}
