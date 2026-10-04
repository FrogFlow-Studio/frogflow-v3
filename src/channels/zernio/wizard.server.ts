import type { TenantContext } from "@/core/tenant/resolve.server";
import { updateZernioWizard } from "@/core/tenant/resolve.server";
import { servedByV2 } from "@/core/tenant/directory";
import type {
  WizardEntry,
  WizardPlatform,
  WizardProblem,
  WizardStep,
} from "@/core/tenant/wizard-entry";
import { pageAll } from "@/core/db/page";
import { zernioConfigured } from "./api.server";
import { connectLink, syncAccounts, v2WebhookStatus, type SyncResult } from "./connect.server";
import { parseZernioMessage, type ZernioWebhookMessagePayload } from "./message";
import {
  entryChanged,
  evaluateWizard,
  explainableFailure,
  problemOfFailure,
  type WizardView,
} from "./wizard";

/**
 * Мастер подключения Instagram/WhatsApp: шаги выводятся из фактов (wizard.ts),
 * здесь — сами факты и запись «где застряли» для оператора. Тестовое
 * сообщение мы не отправляем: продавец пишет в свой канал с другого аккаунта,
 * а мы ищем это входящее в журнале вебхука (zernio_logs) — так проверяется
 * весь путь Zernio → вебхук → магазин, и отправлять нечего, значит, нечему
 * удвоиться при повторе. Клиентов прежней платформы мастер не трогает.
 */
export type WizardState = WizardView & {
  platform: WizardPlatform;
  /** Продавец уже начал подключение (есть запись). */
  started: boolean;
  testSince?: string;
};

const stateOf = (
  platform: WizardPlatform,
  v: WizardView,
  e: WizardEntry | undefined,
): WizardState => ({
  platform,
  ...v,
  started: Boolean(e),
  ...(e?.test_since && v.step === "test" ? { testSince: e.test_since } : {}),
});

/** Записать шаг и причину; без записи (продавец не начинал) пишем только при `create`. */
async function record(
  ctx: TenantContext,
  platform: WizardPlatform,
  v: WizardView,
  opts: { create: boolean; now: Date; testAt?: string },
): Promise<WizardEntry | undefined> {
  const now = opts.now.toISOString();
  return updateZernioWizard(ctx.tenant.id, platform, (cur) => {
    if (!cur && !opts.create) return undefined;
    if (cur && !entryChanged(cur, v)) return undefined;
    const inTest = v.step === "test" || v.step === "done";
    const next: WizardEntry = {
      step: v.step,
      at: now,
      started_at: cur?.started_at ?? now,
      ...(v.problem ? { problem: v.problem } : {}),
      // Тест ждёт сообщение, написанное после входа на шаг; вышли с шага — начнём заново.
      ...(inTest ? { test_since: cur?.test_since ?? now } : {}),
      ...(v.step === "done" ? { test_at: opts.testAt ?? cur?.test_at ?? now } : {}),
    };
    return next;
  });
}

const entryOf = (ctx: TenantContext, platform: WizardPlatform) =>
  ctx.tenant.settings.zernio?.wizard?.[platform];

/** Что уже записано — без обращений к Zernio (для первого показа карточки). */
export function wizardSnapshot(ctx: TenantContext): WizardState[] {
  const out: WizardState[] = [];
  for (const p of ["instagram", "whatsapp"] as const) {
    const e = entryOf(ctx, p);
    if (e) out.push(stateOf(p, { step: e.step, problem: e.problem }, e));
  }
  return out;
}

/** Пришло ли в журнал вебхука входящее в этот канал после `since`. */
async function testMessageSeen(
  ctx: TenantContext,
  platform: WizardPlatform,
  since: string,
): Promise<string | null> {
  const rows = await pageAll<{ payload: unknown; created_at: string }>(
    (from, to) =>
      ctx.db
        .from("zernio_logs")
        .select("payload, created_at")
        .eq("bot_id", ctx.tenant.id)
        .eq("event_type", "message.received")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "Мастер каналов: журнал вебхука не прочитан",
  );
  for (const r of rows) {
    const m = parseZernioMessage(r.payload as ZernioWebhookMessagePayload);
    if (!m.outgoing && m.platform === platform) return r.created_at;
  }
  return null;
}

type Probe = { ok: true; sync: SyncResult } | { ok: false; problem: WizardProblem };

async function probeAccounts(ctx: TenantContext): Promise<Probe> {
  try {
    return { ok: true, sync: await syncAccounts(ctx.tenant) };
  } catch (e) {
    const f = explainableFailure(e);
    if (!f) throw e;
    return { ok: false, problem: problemOfFailure(f) };
  }
}

async function webhookFact(): Promise<"ok" | "off" | "error"> {
  try {
    const s = await v2WebhookStatus();
    if (s.action === "error") return "error";
    return s.ok ? "ok" : "off";
  } catch (e) {
    if (explainableFailure(e)) return "error";
    throw e;
  }
}

/**
 * Кнопка «Проверить»: сверяет аккаунты, вебхук и тестовое сообщение, ставит
 * мастер на нужный шаг. Записывает состояние, только если продавец уже
 * начинал (или `create`): страницу открывают чаще, чем подключают.
 */
export async function checkWizard(
  ctx: TenantContext,
  platform: WizardPlatform,
  opts: { create?: boolean; now?: Date } = {},
): Promise<WizardState> {
  const now = opts.now ?? new Date();
  const create = opts.create === true;
  const cur = entryOf(ctx, platform);
  if (!servedByV2(ctx.tenant)) return stateOf(platform, { step: "login" }, undefined);
  const configured = zernioConfigured();
  if (!configured) {
    const v: WizardView = { step: "login", problem: "not_configured" };
    return stateOf(platform, v, (await record(ctx, platform, v, { create, now })) ?? cur);
  }

  let account: { expired: boolean } | null = null;
  let conflict = false;
  if (ctx.tenant.settings.zernio?.profile_id) {
    const probe = await probeAccounts(ctx);
    if (!probe.ok) {
      const v: WizardView = { step: "login", problem: probe.problem };
      return stateOf(platform, v, (await record(ctx, platform, v, { create, now })) ?? cur);
    }
    const mine = probe.sync.accounts.find((a) => a.platform === platform);
    account = mine ? { expired: mine.expired === true } : null;
    conflict = !mine && probe.sync.conflicts.some((c) => c.platform === platform);
  }

  const live = account !== null && !account.expired;
  const webhook = live ? await webhookFact() : "ok";
  let testAt: string | undefined = cur?.test_at;
  if (live && webhook === "ok" && !testAt && cur?.test_since)
    testAt = (await testMessageSeen(ctx, platform, cur.test_since)) ?? undefined;
  const view = evaluateWizard({
    configured,
    account,
    conflict,
    webhook,
    testReceived: Boolean(testAt),
  });
  const saved = await record(ctx, platform, view, { create, now, testAt });
  return stateOf(platform, view, saved ?? cur);
}

export type WizardStart = { url: string | null; state: WizardState };

/**
 * Шаг «войдите»: ссылка входа Zernio. Повтор после сбоя безопасен: профиль
 * магазина ищется по имени (ensureTenantProfile), второй не создаётся, а
 * когда ответ Zernio неизвестен (500, обрыв), мастер просит сначала
 * нажать «Проверить», а не жать «Войти» вслепую.
 */
export async function startWizard(
  ctx: TenantContext,
  platform: WizardPlatform,
  now = new Date(),
): Promise<WizardStart> {
  if (!servedByV2(ctx.tenant))
    return { url: null, state: stateOf(platform, { step: "login" }, undefined) };
  if (!zernioConfigured()) {
    const v: WizardView = { step: "login", problem: "not_configured" };
    return {
      url: null,
      state: stateOf(platform, v, await record(ctx, platform, v, { create: true, now })),
    };
  }
  // Уже вошли — мастер сам встанет на вебхук или тест, ссылка не нужна.
  const state = await checkWizard(ctx, platform, { create: true, now });
  if (state.step !== "login" || state.problem === "conflict") return { url: null, state };
  try {
    const url = await connectLink(ctx.tenant, platform);
    return { url, state };
  } catch (e) {
    const f = explainableFailure(e);
    if (!f) throw e;
    const v: WizardView = { step: "login", problem: problemOfFailure(f) };
    return {
      url: null,
      state: stateOf(platform, v, await record(ctx, platform, v, { create: true, now })),
    };
  }
}

/** Что показать оператору: канал, шаг, причина и с какого времени. */
export type WizardOperatorRow = {
  platform: WizardPlatform;
  step: WizardStep;
  problem: WizardProblem | null;
  startedAt: string;
  at: string;
  testAt: string | null;
};

export function wizardOperatorRows(ctx: Pick<TenantContext, "tenant">): WizardOperatorRow[] {
  const w = ctx.tenant.settings.zernio?.wizard ?? {};
  return (["instagram", "whatsapp"] as const).flatMap((platform) => {
    const e = w[platform];
    return e
      ? [
          {
            platform,
            step: e.step,
            problem: e.problem ?? null,
            startedAt: e.started_at,
            at: e.at,
            testAt: e.test_at ?? null,
          },
        ]
      : [];
  });
}
