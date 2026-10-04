import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { servedByV2 } from "@/core/tenant/directory";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { trialExtension } from "@/core/plans/plans";
import type { ModuleKey } from "@/core/modules/registry";
import type { Tenant } from "@/core/tenant/types";
import { serverFailure } from "@/lib/server-failure";
import { shownError } from "@/lib/shown-error";
import { localDayHour } from "./morning-brief";
import {
  BULK_BUDGET_MS,
  BULK_MAX,
  checkAction,
  confirmMatches,
  extendBatchKey,
  messageDayKey,
  type BulkAction,
  type BulkResult,
} from "./bulk";

/** Что реально делают действия; в тестах подменяется, по умолчанию — настоящие функции оператора. */
export type BulkDeps = {
  tenants: () => Promise<Tenant[]>;
  /** Условная запись метки: true — метку поставили мы, false — уже стояла (проиграли). */
  claim: (botId: string, key: string, value: string) => Promise<boolean>;
  sendMessage: (
    botId: string,
    text: string,
  ) => Promise<{ delivered: number; reason: string | null }>;
  extend: (t: Tenant, days: number, actor: string) => Promise<string>;
  enableModule: (botId: string, key: ModuleKey, actor: string) => Promise<void>;
  log: (botId: string, payload: Record<string, unknown>, actor: string) => Promise<void>;
  now: () => number;
  day: (now: Date) => string;
};

export async function claimMark(botId: string, key: string, value: string): Promise<boolean> {
  const { error } = await serviceDb().from("app_settings").insert({ bot_id: botId, key, value });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw serverFailure(`[массовые действия] метка не записана: ${error.message}`);
}

const realDeps = (): BulkDeps => ({
  tenants: () => tenantDirectory(true),
  claim: claimMark,
  sendMessage: async (botId, text) => {
    const { notifyOwner } = await import("./operator.server");
    const { NO_RECIPIENTS_REASON } = await import("@/core/notify/deliver");
    const r = await notifyOwner(botId, text);
    return {
      delivered: r.delivered.length,
      reason: r.delivered.length ? null : (r.failed[0]?.reason ?? NO_RECIPIENTS_REASON),
    };
  },
  extend: extendTenant,
  enableModule: async (botId, key, actor) => {
    const { setModule } = await import("./operator.server");
    await setModule(botId, key, true, actor);
  },
  log: async (botId, payload, actor) => {
    const { logEvent } = await import("./operator.server");
    await logEvent(botId, "meta", payload, actor);
  },
  now: () => Date.now(),
  day: (now) => localDayHour(now, env().APP_TIMEZONE).day,
});

/**
 * Продление: пробный период — как кнопка в карточке клиента; платящему
 * добавляется нулевой платёж вплотную к сроку (виден в платежах и журнале).
 * Клиенту без срока продлевать нечего.
 */
export async function extendTenant(t: Tenant, days: number, actor: string): Promise<string> {
  const billing = await import("./billing.server");
  const expires = (await billing.subscriptionExpiresAt(t.id))?.slice(0, 10) ?? null;
  const trialUntil = t.settings.billing?.trial_until ?? null;
  if (trialUntil && (!expires || expires <= trialUntil)) {
    const { extendTrial } = await import("./plans.server");
    const r = await extendTrial(t.id, days, actor);
    return `пробный период до ${r.until}`;
  }
  if (!expires) throw new Error("у клиента нет срока подписки");
  const today = new Date().toISOString().slice(0, 10);
  const { start, end } = trialExtension(expires, days, today);
  await billing.addPayment(
    t.id,
    {
      period_start: start,
      period_end: end,
      amount: 0,
      currency: "KZT",
      note: `Продление тарифа на ${days} дн. (массовое действие оператора)`,
    },
    actor,
  );
  return `подписка до ${end}`;
}

export type BulkInput = {
  botIds: string[];
  action: BulkAction;
  /** Один на подтверждение: повтор того же запуска не продлит клиента второй раз. */
  batchId: string;
  /** Число клиентов, введённое оператором. */
  confirmCount: string;
  actor: string;
};

const POOL = 4;

/**
 * Выполняет действие над выбранными клиентами. Клиенты v1 и архивные
 * пропускаются (в отчёте с причиной), бюджет времени конечен: не успевшие
 * получают «отложено» — оператор повторяет запуск с тем же batchId, сделанное
 * не повторится (метки «один раз» ставятся до действия).
 */
export async function runBulk(
  input: BulkInput,
  deps: BulkDeps = realDeps(),
): Promise<{ results: BulkResult[] }> {
  const ids = [...new Set(input.botIds)];
  if (ids.length === 0) throw shownError("Не выбрано ни одного клиента.");
  if (ids.length > BULK_MAX)
    throw shownError(
      `Выбрано ${ids.length} клиентов, за раз — не больше ${BULK_MAX}: сузьте фильтр.`,
    );
  if (!confirmMatches(input.confirmCount, ids.length))
    throw shownError(`Подтверждение: введите число клиентов — ${ids.length}.`);
  const bad = checkAction(input.action);
  if (bad) throw shownError(bad);

  const startedAt = deps.now();
  const day = deps.day(new Date(startedAt));
  const byId = new Map((await deps.tenants()).map((t) => [t.id, t]));
  const out = new Map<string, BulkResult>();
  const put = (botId: string, name: string, status: BulkResult["status"], note: string) =>
    out.set(botId, { botId, name, status, note });

  async function one(id: string) {
    const t = byId.get(id);
    if (!t) return put(id, "—", "skipped", "клиент не найден");
    if (t.archived) return put(id, t.name, "skipped", "клиент в архиве");
    if (!servedByV2(t)) return put(id, t.name, "skipped", "клиент на прежней платформе (v1)");
    if (deps.now() - startedAt > BULK_BUDGET_MS)
      return put(id, t.name, "deferred", "не хватило времени — повторите запуск");
    const a = input.action;
    try {
      if (a.kind === "message") {
        if (!t.telegramTokenEnc) return put(id, t.name, "skipped", "нет Telegram-бота");
        if (!(await deps.claim(id, messageDayKey(day), String(startedAt))))
          return put(id, t.name, "skipped", "сегодня клиенту уже писали");
        const r = await deps.sendMessage(id, a.text.trim());
        if (r.reason) return put(id, t.name, "failed", `не доставлено: ${r.reason}`);
        await deps.log(id, { bulk: "message", batch: input.batchId }, input.actor);
        return put(id, t.name, "done", "доставлено");
      }
      if (a.kind === "extend") {
        if (!(await deps.claim(id, extendBatchKey(input.batchId), String(startedAt))))
          return put(id, t.name, "skipped", "этим запуском уже продлено");
        const note = await deps.extend(t, a.days, input.actor);
        await deps.log(id, { bulk: "extend", days: a.days, batch: input.batchId }, input.actor);
        return put(id, t.name, "done", note);
      }
      if (t.modules[a.module as ModuleKey]) return put(id, t.name, "skipped", "модуль уже включён");
      await deps.enableModule(id, a.module as ModuleKey, input.actor);
      await deps.log(id, { bulk: "module", module: a.module, batch: input.batchId }, input.actor);
      return put(id, t.name, "done", "включён");
    } catch (e) {
      return put(id, t.name, "failed", e instanceof Error ? e.message : String(e));
    }
  }

  const queue = [...ids];
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await one(id);
    }),
  );
  return { results: ids.map((id) => out.get(id)!) };
}
