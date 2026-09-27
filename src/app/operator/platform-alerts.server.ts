import type { Tenant } from "@/core/tenant/types";
import { cronProbe, platformKey, zernioWebhookProbe, type HealthProbe } from "./health-alerts";

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
  return { probes, labels };
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
    const { probes, labels } = platformProbes({
      crons: await listCronStatus(),
      zernioWebhook,
      tenants,
      cronTitles: new Map(CRON_JOBS.map((j) => [j.job, j.title])),
    });
    const { processPlatformAlerts } = await import("./health-alerts.server");
    return await processPlatformAlerts(probes, labels);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
