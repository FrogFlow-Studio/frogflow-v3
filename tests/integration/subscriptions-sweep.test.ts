import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import {
  invalidateTenantDirectory,
  patchTenantSettings,
  requireTenant,
} from "@/core/tenant/resolve.server";
import { sweepSubscriptions, subscriptionExpiresAt } from "@/app/operator/billing.server";

/**
 * Обход подписок на демо-клиенте: «истекает» → предупреждение с меткой в
 * журнале, повторный проход в тот же день молчит, новый день — снова.
 * Уведомление подменено; ветка приостановки не трогает живой статус.
 */
let prevExpires: string | null = null;
let prevPolicy: Record<string, unknown> = {};
const sent: string[] = [];
const notify = async (_botId: string, text: string) => {
  sent.push(text);
  return { ok: true, detail: "fake" };
};

async function cleanupEvents() {
  await serviceDb()
    .from("bot_events")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("actor", "cron")
    .like("payload->>sweep_marker", "warn:%");
}

describe.skipIf(!liveReady)("обход подписок", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    prevExpires = await subscriptionExpiresAt(DEMO_BOT);
    prevPolicy = {
      on_overdue: t.settings.on_overdue ?? null,
      warn_days_before: t.settings.warn_days_before ?? null,
      grace_days: t.settings.grace_days ?? null,
    };
    await cleanupEvents();
    await patchTenantSettings(DEMO_BOT, { on_overdue: "warn", warn_days_before: 5, grace_days: 3 });
    await serviceDb()
      .from("bots")
      .update({ subscription_expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() })
      .eq("id", DEMO_BOT);
    invalidateTenantDirectory();
  });
  afterAll(async () => {
    await cleanupEvents();
    await patchTenantSettings(DEMO_BOT, prevPolicy);
    await serviceDb()
      .from("bots")
      .update({ subscription_expires_at: prevExpires })
      .eq("id", DEMO_BOT);
    invalidateTenantDirectory();
  });

  it("истекает через 2 дня — предупреждает; тот же день — молчит; следующий день — снова", async () => {
    const now = new Date();
    const first = (await sweepSubscriptions(now, notify, DEMO_BOT)).find(
      (e) => e.bot_id === DEMO_BOT,
    )!;
    expect(first.state).toBe("expiring");
    expect(first.action).toBe("warned");
    expect(sent[0]).toMatch(/заканчивается через 2 дн\./);
    const again = (await sweepSubscriptions(now, notify, DEMO_BOT)).find(
      (e) => e.bot_id === DEMO_BOT,
    )!;
    expect(again.action).toBe("skipped");
    expect(sent).toHaveLength(1);
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const next = (await sweepSubscriptions(tomorrow, notify, DEMO_BOT)).find(
      (e) => e.bot_id === DEMO_BOT,
    )!;
    expect(next.action).toBe("warned");
    expect(sent).toHaveLength(2);
  });

  it("недоставленное предупреждение не помечается сделанным", async () => {
    const day = new Date(Date.now() + 2 * 86_400_000);
    const failing = async () => ({ ok: false, detail: "бот молчит" });
    const r1 = (await sweepSubscriptions(day, failing, DEMO_BOT)).find(
      (e) => e.bot_id === DEMO_BOT,
    )!;
    expect(r1.action).toBe("failed");
    const r2 = (await sweepSubscriptions(day, notify, DEMO_BOT)).find(
      (e) => e.bot_id === DEMO_BOT,
    )!;
    expect(r2.action).toBe("warned");
  });
});
