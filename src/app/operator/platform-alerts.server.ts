import type { Tenant } from "@/core/tenant/types";
import {
  cronProbe,
  inboundProbe,
  platformKey,
  rateProbe,
  zernioWebhookProbe,
  type HealthProbe,
} from "./health-alerts";
import { serverFailure } from "@/lib/server-failure";
import { pricelistMode } from "@/core/consultant/pricelist/mode";
import {
  effectiveRateSource,
  parseStoredRate,
  RATE_ALERT_AFTER_HOURS,
} from "@/core/consultant/pricelist/rate";
import { VTB_LAST_ERROR_KEY, VTB_RATE_KEY } from "@/core/consultant/pricelist/rate.server";
import { zernioTwins } from "@/core/tenant/zernio-accounts";

/**
 * Проверки платформы для оповещений оператору (крон health, раз в 15
 * минут): кроны — по последнему запуску (cron-status), вебхук Zernio v2 —
 * чтением его записи, аккаунты Instagram/WhatsApp клиентов v2 — по снимку в
 * настройках (его обновляет сверка с Zernio в том же кроне). Раньше всё это
 * было видно только на страницах панели или продавцу.
 */
export type PlatformReadings = {
  crons: Parameters<typeof cronProbe>[0][];
  /** null — ни у одного клиента v2 нет Zernio: вебхук не проверяем. */
  zernioWebhook: { ok: boolean; action: string; error?: string } | null;
  tenants: readonly Pick<Tenant, "id" | "name" | "settings" | "archived">[];
  cronTitles: Map<string, string>;
  /** Входящие Zernio по клиентам v2 с аккаунтами (inboundReadings). */
  inbound?: Array<{ botId: string; last: string | null; weekBefore: number }>;
  /** Курс рубля консультантов по прайсу (rateReadings). */
  rates?: RateReading[];
  now?: number;
};

const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", whatsapp: "WhatsApp" };

export function platformProbes(r: PlatformReadings): {
  probes: HealthProbe[];
  labels: Map<string, string>;
} {
  const probes: HealthProbe[] = [];
  const labels = new Map<string, string>();
  for (const c of r.crons) {
    const p = cronProbe(c);
    if (!p) continue;
    probes.push(p);
    labels.set(p.bot_id, r.cronTitles.get(c.job) ?? c.job);
  }
  if (r.zernioWebhook) probes.push(zernioWebhookProbe(r.zernioWebhook));
  for (const t of r.tenants) {
    if (t.settings.served_by !== "v2" || t.archived) continue;
    for (const a of t.settings.zernio?.accounts ?? []) {
      if (!a.id) continue;
      const key = platformKey({ kind: "account", botId: t.id, accountId: a.id });
      probes.push({ bot_id: key, ok: !a.expired, error: a.expired ? "аккаунт отвязан" : null });
      const who = a.username ? `@${a.username}` : a.name || a.id;
      labels.set(key, `${PLATFORM_NAME[a.platform] ?? a.platform} ${who} клиента «${t.name}»`);
    }
    // Два живых подключения одной страницы — сбой; одно — проба «в порядке»,
    // чтобы после сообщения о сбое пришло и «снова одно подключение».
    const accounts = t.settings.zernio?.accounts ?? [];
    const twins = zernioTwins(accounts);
    const handles = new Map<string, { platform: string; username: string }>();
    for (const a of accounts)
      if (a.id && !a.expired && a.username?.trim())
        handles.set(`${a.platform}:${a.username.trim().toLowerCase()}`, {
          platform: a.platform,
          username: a.username.trim(),
        });
    for (const h of handles.values()) {
      const key = platformKey({ kind: "twin", botId: t.id, ...h });
      const twin = twins.find(
        (w) => w.platform === h.platform && w.username.toLowerCase() === h.username.toLowerCase(),
      );
      probes.push({ bot_id: key, ok: !twin, error: twin ? `id ${twin.ids.join(", ")}` : null });
      labels.set(
        key,
        `${PLATFORM_NAME[h.platform] ?? h.platform} @${h.username} клиента «${t.name}»`,
      );
    }
  }
  const names = new Map(r.tenants.map((t) => [t.id, t.name]));
  for (const i of r.inbound ?? []) {
    const p = inboundProbe({ ...i, now: r.now ?? Date.now() });
    if (!p) continue;
    probes.push(p);
    labels.set(p.bot_id, `Клиент «${names.get(i.botId) ?? i.botId}»`);
  }
  for (const r0 of r.rates ?? []) {
    const p = rateProbe({
      ...r0,
      alertAfterHours: RATE_ALERT_AFTER_HOURS,
      now: r.now ?? Date.now(),
    });
    probes.push(p);
    labels.set(p.bot_id, `Консультант клиента «${names.get(r0.botId) ?? r0.botId}»`);
  }
  return { probes, labels };
}

export type RateReading = { botId: string; updatedAt: string | null; lastError: string | null };

/** Строки app_settings клиента → когда обновился курс и чем кончилась последняя попытка. */
export function rateReading(
  botId: string,
  rows: Array<{ key: string; value: string | null }>,
): RateReading {
  const raw = rows.find((x) => x.key === VTB_RATE_KEY)?.value;
  const rate = parseStoredRate(raw);
  let lastError: string | null = null;
  try {
    const log = JSON.parse(rows.find((x) => x.key === VTB_LAST_ERROR_KEY)?.value ?? "") as {
      ok?: boolean;
      attempts?: unknown;
    };
    if (log && log.ok === false && Array.isArray(log.attempts) && log.attempts.length)
      lastError = log.attempts.map(String).join("; ");
  } catch {
    // журнала нет или он битый — причина просто не указывается
  }
  return { botId, updatedAt: rate?.updatedAt ?? null, lastError };
}

/** Чей курс проверять: консультант по прайсу включён и курс не вручную (его крон не обновляет). */
export function rateTenantIds(tenants: readonly Pick<Tenant, "id" | "settings">[]): string[] {
  return tenants
    .filter(
      (t) => pricelistMode(t) && effectiveRateSource(t.settings.consultant_pricelist) !== "manual",
    )
    .map((t) => t.id);
}

/**
 * Курс рубля у клиентов v2 с консультантом по прайсу, кроме курса вручную
 * (его крон не обновляет). serviceDb: крон по всем клиентам. Сбой чтения —
 * исключение: «не прочитали» не равно «курса нет».
 */
export async function rateReadings(
  tenants: readonly Pick<Tenant, "id" | "settings">[],
): Promise<RateReading[]> {
  const ids = rateTenantIds(tenants);
  const { serviceDb } = await import("@/core/db/client.server");
  const db = serviceDb();
  const out: RateReading[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    // Две строки на клиента, кусок — не больше 400 строк: в предел ответа влезает.
    const { data, error } = await db
      .from("app_settings")
      .select("bot_id, key, value")
      .in("bot_id", chunk)
      .in("key", [VTB_RATE_KEY, VTB_LAST_ERROR_KEY]);
    if (error) throw serverFailure(`app_settings: ${error.message}`);
    const rows = (data ?? []) as Array<{ bot_id: string; key: string; value: string | null }>;
    for (const id of chunk)
      out.push(
        rateReading(
          id,
          rows.filter((x) => x.bot_id === id),
        ),
      );
  }
  return out;
}

/** Исходящие у Zernio — другие события: message.received — всегда входящее. */
const INCOMING = "message.received";
const INBOUND_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Последнее входящее в Zernio и сколько их было за неделю до него —
 * у клиентов v2 с аккаунтами Instagram/WhatsApp (журнал zernio_logs, serviceDb:
 * крон по всем клиентам). Сбой чтения — исключение: «не прочитали» не равно
 * «тишина».
 */
export async function inboundReadings(
  tenants: readonly Pick<Tenant, "id" | "settings">[],
): Promise<Array<{ botId: string; last: string | null; weekBefore: number }>> {
  const { serviceDb } = await import("@/core/db/client.server");
  const db = serviceDb();
  const out: Array<{ botId: string; last: string | null; weekBefore: number }> = [];
  for (const t of tenants) {
    if (!(t.settings.zernio?.accounts ?? []).some((a) => a.id && !a.expired)) continue;
    const lastQ = await db
      .from("zernio_logs")
      .select("created_at")
      .eq("bot_id", t.id)
      .eq("status", "processed")
      .eq("event_type", INCOMING)
      // Нужна только дата самого свежего: при равных created_at неважно, какая
      // строка. Без хвоста по id запрос идёт по индексу (bot_id, status,
      // created_at) за миллисекунды; фильтр по payload читал бы весь журнал (8 с).
      .order("created_at", { ascending: false })
      .limit(1);
    if (lastQ.error) throw serverFailure(`zernio_logs: ${lastQ.error.message}`);
    const last = (lastQ.data?.[0]?.created_at as string | undefined) ?? null;
    if (!last) {
      out.push({ botId: t.id, last: null, weekBefore: 0 });
      continue;
    }
    // Неделя до последнего входящего, а не до «сейчас»: после недели тишины
    // клиент не должен стать «тихим по природе» и закрыть сбой сам.
    const weekQ = await db
      .from("zernio_logs")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", t.id)
      .eq("status", "processed")
      .eq("event_type", INCOMING)
      .gte("created_at", new Date(Date.parse(last) - 7 * INBOUND_DAY_MS).toISOString())
      .lte("created_at", last);
    if (weekQ.error) throw serverFailure(`zernio_logs: ${weekQ.error.message}`);
    out.push({ botId: t.id, last, weekBefore: weekQ.count ?? 0 });
  }
  return out;
}

/** Прогон из крона health: читает всё свежим и шлёт оператору переходы. */
export async function runPlatformAlerts(): Promise<unknown> {
  try {
    const { tenantDirectory } = await import("@/core/tenant/resolve.server");
    const { CRON_JOBS, listCronStatus } = await import("./cron-status.server");
    const tenants = (await tenantDirectory(true)).filter(
      (t) => t.settings.served_by === "v2" && !t.archived,
    );
    const zernioInUse = tenants.some(
      (t) => t.settings.zernio?.profile_id || t.settings.zernio?.account_ids?.length,
    );
    // Сбой проверки вебхука не роняет пробы кронов и аккаунтов; сам он — сбой пробы.
    const zernioWebhook = zernioInUse
      ? await (
          await import("@/channels/zernio/connect.server")
        )
          .v2WebhookStatus()
          .catch((e: unknown) => ({
            ok: false,
            action: "check",
            error: `вебхук v2 не проверен: ${e instanceof Error ? e.message : String(e)}`,
          }))
      : null;
    const now = Date.now();
    // Сбой чтения журнала не роняет остальные пробы: тишину просто не проверяем.
    const inbound = await inboundReadings(tenants).catch((e: unknown) => {
      console.warn("[platform-alerts] входящие не прочитаны", e instanceof Error ? e.message : e);
      return [];
    });
    const rates = await rateReadings(tenants).catch((e: unknown) => {
      console.warn("[platform-alerts] курс не прочитан", e instanceof Error ? e.message : e);
      return [];
    });
    const { probes, labels } = platformProbes({
      crons: await listCronStatus(),
      zernioWebhook,
      tenants,
      cronTitles: new Map(CRON_JOBS.map((j) => [j.job, j.title])),
      inbound,
      rates,
      now,
    });
    const { processPlatformAlerts } = await import("./health-alerts.server");
    return await processPlatformAlerts(probes, labels);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
