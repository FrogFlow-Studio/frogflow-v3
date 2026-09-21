import { afterAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { env } from "@/config/env";
import { serviceDb } from "@/core/db/client.server";
import { encryptSecret } from "@/core/secrets/vault";
import { requireTenant } from "@/core/tenant/resolve.server";
import {
  getHealthHistory,
  latestHealth,
  recordHealthSnapshotsFor,
} from "@/app/operator/health.server";

/**
 * Снимок здоровья: у демо-клиента нет токена Telegram, поэтому подставляем
 * заведомо неверный (зашифрованный тем же ключом) — Telegram отвечает
 * отказом, снимок пишется как сбой с текстом ошибки, история его видит.
 */
const startedAt = new Date().toISOString();

describe.skipIf(!liveReady)("снимки здоровья ботов", () => {
  afterAll(async () => {
    await serviceDb()
      .from("bot_health_snapshots")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .gte("at", startedAt);
  });

  it("сбойный бот пишется как сбой с причиной; последний снимок и история видят его", async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    const fake = { ...tenant, telegramTokenEnc: encryptSecret("1:fake-token", env().SECRETS_KEY) };
    const r = await recordHealthSnapshotsFor([fake]);
    expect(r.inserted).toBe(1);
    expect(r.failing).toEqual([DEMO_BOT]);
    const latest = (await latestHealth([DEMO_BOT])).get(DEMO_BOT)!;
    expect(latest.ok).toBe(false);
    expect(latest.error).toBeTruthy();
    const h = await getHealthHistory(DEMO_BOT, 1);
    expect(h.snapshotCount).toBeGreaterThanOrEqual(1);
    expect(h.outages[0]?.endedAt).toBeNull();
  });

  it("клиент без токена не даёт снимка — это не падение, а недоделанная настройка", async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    const r = await recordHealthSnapshotsFor([{ ...tenant, telegramTokenEnc: null }]);
    expect(r.inserted).toBe(0);
  });
});
