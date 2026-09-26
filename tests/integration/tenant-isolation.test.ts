import { describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, OTHER_BOT } from "./live";
import { serviceDb, tenantDb } from "@/core/db/client.server";
import { tenantDirectory } from "@/core/tenant/resolve.server";
import { findTenant } from "@/core/tenant/directory";
import { env } from "@/config/env";
import { mintTenantJwt } from "@/core/tenant/jwt";

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

/**
 * Изоляция под ключом арендатора, как tests/tenant-isolation в v1. К данным
 * настоящих клиентов — только попытки чтения под ключом «Демо-тестера»,
 * которые обязаны вернуть пусто или отказ; ничего у них не пишется.
 */
describe.skipIf(!liveReady)("живая база: ключ арендатора не видит чужого", () => {
  /** Под ключом демо: своё читается без ошибки, чужое не видно ни фильтром, ни скопом. */
  async function onlyOwn(table: "orders" | "bot_users") {
    const demoDb = tenantDb(DEMO_BOT);
    const own = await demoDb.from(table).select("bot_id").limit(1000);
    expect(own.error).toBeNull();
    expect((own.data ?? []).every((r) => r.bot_id === DEMO_BOT)).toBe(true);
    const foreign = await demoDb.from(table).select("bot_id").eq("bot_id", OTHER_BOT).limit(5);
    expect(foreign.data ?? []).toEqual([]);
    const { count } = await demoDb.from(table).select("bot_id", { count: "exact", head: true });
    const { count: real } = await serviceDb()
      .from(table)
      .select("bot_id", { count: "exact", head: true })
      .eq("bot_id", DEMO_BOT);
    expect(count).toBe(real);
  }

  it("ключ арендатора видит только свои заказы", async () => {
    await onlyOwn("orders");
  });

  it("ключ арендатора видит только своих покупателей", async () => {
    await onlyOwn("bot_users");
  });

  it("служебные таблицы панели арендатору недоступны", async () => {
    const demoDb = tenantDb(DEMO_BOT);
    for (const table of ["operator_broadcasts", "operator_login_attempts"] as const) {
      const { data, error } = await demoDb.from(table).select("*").limit(1);
      // Права отозваны или RLS без политик: отказ либо пустой ответ, но не строки.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    const events = await demoDb
      .from("bot_events")
      .select("bot_id")
      .eq("bot_id", OTHER_BOT)
      .limit(1);
    expect(events.data ?? []).toEqual([]);
  });

  it("подделанная подпись не принимается", async () => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
    const forged = mintTenantJwt(DEMO_BOT, "not-the-project-secret-not-the-project-secret");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bots?select=id`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${forged}` },
    });
    expect(res.status).toBe(401);
  });
});
