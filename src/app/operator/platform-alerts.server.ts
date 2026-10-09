import type { Tenant } from "@/core/tenant/types";
import {
  cronProbe,
  inboundProbe,
  platformKey,
  zernioWebhookProbe,
  type HealthProbe,
} from "./health-alerts";
import { serverFailure } from "@/lib/server-failure";

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
  }
  const names = new Map(r.tenants.map((t) => [t.id, t.name]));
  for (const i of r.inbound ?? []) {
    const p = inboundProbe({ ...i, now: r.now ?? Date.now() });
    if (!p) continue;
    probes.push(p);
    labels.set(p.bot_id, `Клиент «${names.get(i.botId) ?? i.botId}»`);
  }
  return { probes, labels };
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
      ? await (await import("@/channels/zernio/connect.server"))
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
    const { probes, labels } = platformProbes({
      crons: await listCronStatus(),
      zernioWebhook,
      tenants,
      cronTitles: new Map(CRON_JOBS.map((j) => [j.job, j.title])),
      inbound,
      now,
    });
    const { processPlatformAlerts } = await import("./health-alerts.server");
    return await processPlatformAlerts(probes, labels);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
