import { serviceDb } from "@/core/db/client.server";
import { pageAll } from "@/core/db/page";
import { logEvent } from "./operator.server";
import { serverFailure } from "@/lib/server-failure";

/** Платежи клиентов. */

export type Payment = {
  id: string;
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  paid_at: string;
  note: string | null;
};

export async function listPayments(botId: string): Promise<Payment[]> {
  // Все платежи постранично, порядок заканчивается уникальным ключом: без обрезки на 100.
  const rows = await pageAll(
    (from, to) =>
      serviceDb()
        .from("subscription_payments")
        .select("id, period_start, period_end, amount, currency, paid_at, note")
        .eq("bot_id", botId)
        .order("period_end", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    "[billing] платежи не прочитаны",
  );
  return rows.map((p) => ({ ...p, amount: Number(p.amount) }));
}

export type NewPayment = {
  period_start: string;
  period_end: string;
  amount: number;
  currency: string;
  note: string | null;
};

export async function subscriptionExpiresAt(botId: string): Promise<string | null> {
  const { data, error: readErr2 } = await serviceDb()
    .from("bots")
    .select("subscription_expires_at")
    .eq("id", botId)
    .maybeSingle();
  if (readErr2) throw serverFailure(`[billing] срок подписки не прочитан: ${readErr2.message}`);
  return data?.subscription_expires_at ?? null;
}

/** Платёж; если бот был приостановлен за просрочку и новый срок в будущем — возвращаем в работу. */
export async function addPayment(
  botId: string,
  p: NewPayment,
  actor: string,
): Promise<{ expiresAt: string | null }> {
  const db = serviceDb();
  const { error } = await db.from("subscription_payments").insert({ bot_id: botId, ...p });
  if (error) throw serverFailure(`Не удалось записать платёж: ${error.message}`);
  await logEvent(
    botId,
    "payment",
    { action: "added", period_end: p.period_end, amount: p.amount, currency: p.currency },
    actor,
  );
  const { data: bot, error: botErr } = await db
    .from("bots")
    .select("status, subscription_expires_at")
    .eq("id", botId)
    .maybeSingle();
  if (botErr) throw serverFailure(`[billing] бот не прочитан после платежа: ${botErr.message}`);
  const expiresAt = bot?.subscription_expires_at ?? null;
  if (bot?.status === "suspended" && expiresAt && new Date(expiresAt).getTime() > Date.now()) {
    await db.from("bots").update({ status: "active" }).eq("id", botId);
    const { invalidateTenantDirectory } = await import("@/core/tenant/resolve.server");
    invalidateTenantDirectory();
    await logEvent(botId, "resume", { reason: "payment_covers_arrears" }, actor);
  }
  return { expiresAt };
}

export async function deletePayment(
  botId: string,
  paymentId: string,
  actor: string,
): Promise<void> {
  const { error } = await serviceDb()
    .from("subscription_payments")
    .delete()
    .eq("id", paymentId)
    .eq("bot_id", botId);
  if (error) throw serverFailure(`[billing] платёж не удалён: ${error.message}`);
  await logEvent(botId, "payment", { action: "deleted", payment_id: paymentId }, actor);
}
