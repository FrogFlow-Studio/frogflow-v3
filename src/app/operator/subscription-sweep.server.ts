import { serviceDb } from "@/core/db/client.server";
import { computeState, readPolicy, type OverduePolicy } from "@/core/billing/subscription";
import type { Tenant } from "@/core/tenant/types";
import { logEvent, notifyOwner } from "./operator.server";
import { NO_RECIPIENTS_REASON } from "@/core/notify/deliver";
import { serverFailure } from "@/lib/server-failure";
import { inChunks } from "@/lib/in-chunks";
import { trialState } from "@/core/plans/trial";
import type { AdminT } from "@/app/i18n/admin";

/** Обход подписок: напоминания, счета, просрочка. */

/* ── обход подписок ─────────────────────────────────────────────────── */

export type SweepAction = "warned" | "suspended" | "skipped" | "failed";

export type SweepEntry = {
  bot_id: string;
  bot_name: string;
  state: string;
  action: SweepAction;
  detail: string;
};

export type SweepNotify = (botId: string, text: string) => Promise<{ ok: boolean; detail: string }>;

const defaultNotify: SweepNotify = async (botId, text) => {
  try {
    const r = await notifyOwner(botId, text);
    return r.delivered.length
      ? { ok: true, detail: "доставлено" }
      : { ok: false, detail: r.failed[0]?.reason ?? NO_RECIPIENTS_REASON };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
};

/**
 * Счёт за следующий период, который обход выставляет сам: только клиенту на
 * плане (ниша × уровень) и только если открытого счёта ещё нет. null —
 * выставлять нечего.
 */
export type SweepInvoicer = (t: Tenant) => Promise<{ amount: number; delivered: boolean } | null>;

const defaultInvoicer: SweepInvoicer = async (t) => {
  const { parsePlan } = await import("@/core/plans/registry");
  if (parsePlan(t.plan)?.kind !== "tier") return null;
  const { data: open, error: openErr } = await serviceDb()
    .from("subscription_invoices")
    .select("id")
    .eq("bot_id", t.id)
    .in("status", ["sent", "proof_uploaded"])
    .limit(20);
  if (openErr) throw serverFailure(`[billing] открытые счета не прочитаны: ${openErr.message}`);
  // Открытое пополнение ИИ-баланса не заменяет счёт за подписку.
  const { openSubscriptionInvoices } = await import("./ai-topup.server");
  if ((await openSubscriptionInvoices(t.id, open ?? [])).length) return null;
  const r = await (
    await import("./plans.server")
  ).createPlanInvoice(
    t.id,
    { period: t.settings.billing?.period ?? "month", addonPrices: {} },
    "cron",
  );
  return { amount: r.invoice.amount, delivered: r.delivered };
};

async function alreadyDone(botId: string, marker: string): Promise<boolean> {
  const { data, error } = await serviceDb()
    .from("bot_events")
    .select("id")
    .eq("bot_id", botId)
    .eq("payload->>sweep_marker", marker)
    .limit(1);
  // Отказ проверки — не повод действовать: лучше пропустить клиента на этом проходе, чем разослать дубль.
  if (error) {
    console.error(`[operator] sweep idempotency check failed for ${botId}: ${error.message}`);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Занять действие обхода ДО его выполнения: проверка `alreadyDone` читает метку,
 * а пишется она после отправки, и два обхода, пришедшие одновременно (окно
 * переключения v2 → v3), прошли бы проверку оба. Занимает вставка строки с
 * уникальным event_id в zernio_logs: проигравший (23505) действие пропускает.
 * Не удалось записать — тоже пропуск: лучше без письма и счёта, чем с двумя.
 */
async function claimSweep(botId: string, marker: string): Promise<boolean> {
  const { error } = await serviceDb()
    .from("zernio_logs")
    .insert({
      bot_id: botId,
      event_id: `sweep:${botId}:${marker}`,
      event_type: "sweep.claim",
      status: "processed",
      payload: { marker },
    });
  if (error && error.code !== "23505")
    console.error(`[operator] sweep claim failed for ${botId}: ${error.message}`);
  return !error;
}

/** Действие не состоялось — снять занятость, чтобы следующий проход повторил. */
async function releaseSweep(botId: string, marker: string): Promise<void> {
  const { error } = await serviceDb()
    .from("zernio_logs")
    .delete()
    .eq("event_id", `sweep:${botId}:${marker}`);
  if (error) console.error(`[operator] sweep release failed for ${botId}: ${error.message}`);
}

/** Текст продавцу на его языке; язык не прочитался — по-русски, напоминание из-за этого не теряется. */
async function sellerText(
  t: Tenant,
  make: (m: typeof import("./subscription-text").subscriptionMessages, tr: AdminT) => string,
): Promise<string> {
  const { subscriptionMessages } = await import("./subscription-text");
  const { adminT } = await import("@/app/i18n/admin");
  try {
    const { tenantContext } = await import("@/core/tenant/resolve.server");
    const { adminLocale } = await import("@/app/admin/locale.server");
    return make(subscriptionMessages, adminT(await adminLocale(tenantContext(t))));
  } catch (e) {
    console.warn(`[billing] язык продавца ${t.id} не прочитан, шлём по-русски:`, e);
    return make(subscriptionMessages, adminT("ru"));
  }
}

/**
 * Ежедневный обход подписок клиентов на v2: предупредить заранее, применить
 * политику после отсрочки. Идемпотентность — метка `sweep_marker` в
 * bot_events (вид действия + период + день): warn уходит раз в день, пока не
 * оплачено; suspend — один раз на период; недоставленное предупреждение не
 * помечается сделанным и повторится на следующем проходе.
 */
export async function sweepSubscriptions(
  now = new Date(),
  notify: SweepNotify = defaultNotify,
  /** Только один клиент (тесты) — без фильтра по served_by. */
  onlyBotId?: string,
  invoicer: SweepInvoicer = defaultInvoicer,
): Promise<SweepEntry[]> {
  const { tenantDirectory, invalidateTenantDirectory } =
    await import("@/core/tenant/resolve.server");
  const tenants = (await tenantDirectory(true)).filter((t) =>
    onlyBotId ? t.id === onlyBotId : t.settings.served_by === "v2" && !t.archived,
  );
  const ids = tenants.map((t) => t.id);
  // Не прочиталось — не «срока нет»: иначе обход молча пропустит всех просроченных.
  const rows = await inChunks(
    ids,
    (chunk) => serviceDb().from("bots").select("id, subscription_expires_at").in("id", chunk),
    "[billing] сроки подписок не прочитаны",
  );
  const expires = new Map(rows.map((r) => [r.id, r.subscription_expires_at]));
  const results: SweepEntry[] = [];
  const dayKey = now.toISOString().slice(0, 10);

  for (const t of tenants) {
    const policy: OverduePolicy = readPolicy(t.settings);
    const sub = computeState(expires.get(t.id) ?? null, policy, now);
    const base = { bot_id: t.id, bot_name: t.name, state: sub.state };
    if (sub.state === "no_data" || sub.state === "ok" || t.status === "suspended") {
      results.push({ ...base, action: "skipped", detail: "нет повода" });
      continue;
    }
    const shouldSuspend = sub.state === "grace_over" && policy.on_overdue === "suspend";
    const marker = shouldSuspend ? `suspend:${sub.expiresAt}` : `warn:${sub.expiresAt}:${dayKey}`;
    if (await alreadyDone(t.id, marker)) {
      results.push({ ...base, action: "skipped", detail: "уже сделано" });
      continue;
    }
    if (!(await claimSweep(t.id, marker))) {
      results.push({ ...base, action: "skipped", detail: "уже сделано" });
      continue;
    }
    if (shouldSuspend) {
      const { error } = await serviceDb()
        .from("bots")
        .update({ status: "suspended" })
        .eq("id", t.id);
      if (error) {
        await releaseSweep(t.id, marker);
        results.push({
          ...base,
          action: "failed",
          detail: `не удалось приостановить: ${error.message}`,
        });
        continue;
      }
      invalidateTenantDirectory();
      await logEvent(
        t.id,
        "suspend",
        { reason: "subscription_overdue", sweep_marker: marker },
        "cron",
      );
      const n = await notify(t.id, await sellerText(t, (m, tr) => m.suspended(tr, sub.daysLeft)));
      results.push({
        ...base,
        action: "suspended",
        detail: n.ok ? "приостановлен, владелец уведомлён" : `приостановлен; ${n.detail}`,
      });
      continue;
    }
    // Счёт на следующий период — один раз на срок, до напоминания: владелец
    // получает сумму и реквизиты Kaspi и отвечает чеком.
    const invoiceMarker = `invoice:${sub.expiresAt}`;
    if (!(await alreadyDone(t.id, invoiceMarker)) && (await claimSweep(t.id, invoiceMarker))) {
      try {
        const inv = await invoicer(t);
        if (inv)
          await logEvent(
            t.id,
            "payment",
            { action: "auto_invoice", amount: inv.amount, sweep_marker: invoiceMarker },
            "cron",
          );
        // Выставлять нечего (клиент не на плане) — не занимаем период.
        else await releaseSweep(t.id, invoiceMarker);
      } catch (e) {
        await releaseSweep(t.id, invoiceMarker);
        console.error(
          `[operator] auto invoice for ${t.id} failed: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    // До конца срока обход молчит: пробному периоду напоминает trial-remind.server.ts,
    // платящему — воронка продлений (renewals.server.ts: 7, 3, 1 день и день окончания,
    // с ценой и способом оплаты). Счёт выше выставлен как обычно. Просрочку ведёт
    // этот обход: ниже предупреждение раз в день.
    if (sub.state === "expiring") {
      results.push({
        ...base,
        action: "skipped",
        detail: trialState(t.settings.billing, expires.get(t.id) ?? null, dayKey)
          ? "пробный период: напоминает отдельный обход"
          : "срок не вышел: напоминает воронка продлений",
      });
      continue;
    }
    const n = await notify(
      t.id,
      await sellerText(t, (m, tr) => m.warn(tr, sub.daysLeft, policy.on_overdue === "suspend")),
    );
    if (!n.ok) {
      await releaseSweep(t.id, marker);
      results.push({ ...base, action: "failed", detail: n.detail });
      continue;
    }
    await logEvent(t.id, "message", { kind: "subscription_warning", sweep_marker: marker }, "cron");
    results.push({ ...base, action: "warned", detail: "владелец предупреждён" });
  }
  return results;
}

export async function setOverduePolicy(
  botId: string,
  policy: OverduePolicy,
  actor: string,
): Promise<void> {
  const { patchTenantSettings } = await import("@/core/tenant/resolve.server");
  await patchTenantSettings(botId, policy);
  await logEvent(botId, "meta", { policy }, actor);
}
