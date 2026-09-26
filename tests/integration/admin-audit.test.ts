import { afterAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { listShopActions, recordShopAction } from "@/app/admin/audit.server";

/** Журнал действий команды магазина на демо-клиенте: пишется в bot_events без секретов. */
const WHO = { botId: DEMO_BOT, username: "v2_probe_audit" };

describe.skipIf(!liveReady)("журнал действий админки на демо-клиенте", () => {
  afterAll(async () => {
    await serviceDb()
      .from("bot_events")
      .delete()
      .eq("bot_id", DEMO_BOT)
      .eq("actor", `admin:${WHO.username}`);
  });

  it("действие видно владельцу, пароль не сохраняется", async () => {
    await recordShopAction(WHO, "saveTeamMemberFn", {
      username: "masha",
      role: "manager",
      password: "never-store-me",
    });
    const rows = (await listShopActions(DEMO_BOT, 50)).filter((r) => r.who === WHO.username);
    expect(rows[0]).toMatchObject({
      who: WHO.username,
      action: "saveTeamMemberFn",
      details: { username: "masha", role: "manager", password: "•••" },
    });
    const { data } = await serviceDb()
      .from("bot_events")
      .select("kind, payload")
      .eq("bot_id", DEMO_BOT)
      .eq("actor", `admin:${WHO.username}`);
    expect(data?.[0]?.kind).toBe("meta");
    expect(JSON.stringify(data)).not.toContain("never-store-me");
  });
});
