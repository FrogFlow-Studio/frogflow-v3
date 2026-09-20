import { describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, OTHER_BOT } from "./live";
import { serviceDb, tenantDb } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { findTenant } from "@/core/tenant/directory";

describe.skipIf(!liveReady)("живая база: справочник и изоляция", () => {
  it("справочник читает неархивных клиентов и находит по app_url", async () => {
    const dir = await tenantDirectory(true);
    expect(dir.length).toBeGreaterThanOrEqual(8);
    expect(dir.every((t) => !t.archived)).toBe(true);
    const demo = findTenant(dir, { by: "id", value: DEMO_BOT });
    expect(demo?.name).toBe("Демо-тестер");
    expect(findTenant(dir, { by: "host", value: "aatech-pi.vercel.app" })?.id).toBe(OTHER_BOT);
    expect(demo?.modules.shop).toBe(true);
  });

  it("ключ арендатора видит только свою строку bots и свои товары", async () => {
    const demoDb = tenantDb(DEMO_BOT);
    const { data: bots, error } = await demoDb.from("bots").select("id");
    expect(error).toBeNull();
    expect(bots?.map((b) => b.id)).toEqual([DEMO_BOT]);

    const { data: foreign } = await serviceDb()
      .from("products")
      .select("id")
      .eq("bot_id", OTHER_BOT)
      .limit(1)
      .single();
    expect(foreign?.id).toBeTruthy();
    const { data: leak } = await demoDb.from("products").select("id").eq("id", foreign!.id);
    expect(leak).toEqual([]);

    const { count } = await demoDb.from("products").select("id", { count: "exact", head: true });
    const { count: real } = await serviceDb()
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", DEMO_BOT);
    expect(count).toBe(real);
  });

  it("вставка под ключом арендатора получает bot_id из claim, чужой bot_id отвергается", async () => {
    const demoDb = tenantDb(DEMO_BOT);
    const key = `v2_probe_${Date.now()}`;
    const { data, error } = await demoDb
      .from("app_settings")
      .insert({ bot_id: OTHER_BOT, key, value: "x" })
      .select("bot_id")
      .single();
    // force_bot_id подменяет bot_id на свой — строка ложится к демо, не к чужому.
    expect(error).toBeNull();
    expect(data?.bot_id).toBe(DEMO_BOT);
    await demoDb.from("app_settings").delete().eq("key", key);
  });
});
