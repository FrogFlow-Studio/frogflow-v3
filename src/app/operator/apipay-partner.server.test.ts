import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

let settings: Record<string, string>;
let tenantSettings: Record<string, unknown>;
const events: Array<{ action: unknown }> = [];
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => ({
    id: "b1",
    name: "AATeach",
    settings: tenantSettings,
    modules: { kaspi_pay: true },
  }),
  tenantContext: (t: unknown) => ({ tenant: t }),
  patchTenantSettings: async (_id: string, patch: Record<string, unknown>) => {
    tenantSettings = { ...tenantSettings, ...patch };
  },
}));
vi.mock("@/core/settings/settings", () => ({
  getSettingsStrict: async (_ctx: unknown, keys: string[]) =>
    Object.fromEntries(keys.filter((k) => k in settings).map((k) => [k, settings[k]])),
  setSetting: async (_ctx: unknown, k: string, v: string) => {
    settings[k] = v;
  },
}));
vi.mock("./client-log.server", () => ({
  logEvent: async (_b: string, _k: string, p: { action: unknown }) => {
    events.push(p);
  },
}));

const srv = await import("./apipay-partner.server");

type Call = { url: string; body: unknown };
let calls: Call[];
let route: (url: string) => { status: number; body: unknown } | "down";

beforeEach(async () => {
  setEnvForTests({});
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  db.tables.operator_settings = [];
  settings = {};
  tenantSettings = { served_by: "v2", apipay: { org_id: "9" } };
  events.length = 0;
  calls = [];
  route = (url) =>
    url.endsWith("/organizations/9")
      ? { status: 200, body: { organization: { id: 9, is_test: true } } }
      : url.endsWith("/api-key")
        ? { status: 201, body: { key: "k-1", webhook_secret: "s-1" } }
        : { status: 404, body: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const r = route(url);
    if (r === "down") throw new Error("timeout");
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
  await srv.setPartnerKey("partner-secret");
});

describe("партнёрский ключ ApiPay", () => {
  it("хранится зашифрованным, читается, пустая строка стирает", async () => {
    const row = db.tables.operator_settings!.find((r) => r.key === "apipay_partner_key");
    expect(String(row?.value)).not.toContain("partner-secret");
    expect(await srv.partnerKeyConfigured()).toBe(true);
    await srv.setPartnerKey("другой");
    expect(db.tables.operator_settings!.filter((r) => r.key === "apipay_partner_key")).toHaveLength(
      1,
    );
    await srv.setPartnerKey("");
    expect(await srv.partnerKeyConfigured()).toBe(false);
  });
});

describe("выпуск ключа продавцу", () => {
  it("ключ и секрет ложатся в настройки, тестовая организация — тестовый режим, вебхук наш", async () => {
    expect(await srv.apipayIssueKey("b1", false, "op")).toEqual({ test: true });
    expect(settings).toEqual({
      kaspi_apipay_api_key: "k-1",
      kaspi_apipay_webhook_secret: "s-1",
      kaspi_apipay_test_mode: "true",
      kaspi_apipay_enabled: "true",
    });
    expect(calls.find((c) => c.url.endsWith("/api-key"))?.body).toEqual({
      name: "FrogFlow",
      webhook_url: "https://app.test/api/kaspi/b1",
    });
    expect(events).toEqual([expect.objectContaining({ action: "apipay_key_issued" })]);
    // отметка снята
    expect(db.tables.operator_settings!.some((r) => String(r.key).startsWith("apipay_lock"))).toBe(
      false,
    );
  });

  it("перевыпуск без подтверждения не вызывает ApiPay", async () => {
    settings.kaspi_apipay_api_key = "old";
    await expect(srv.apipayIssueKey("b1", false, "op")).rejects.toThrow(/Перевыпуск/);
    expect(calls.some((c) => c.url.endsWith("/api-key"))).toBe(false);
    expect(settings.kaspi_apipay_api_key).toBe("old");
  });

  it("двойной клик — один выпуск", async () => {
    const r = await Promise.allSettled([
      srv.apipayIssueKey("b1", false, "op"),
      srv.apipayIssueKey("b1", false, "op"),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/api-key"))).toHaveLength(1);
  });

  it("обрыв на выпуске — не повторяем и просим проверить", async () => {
    const base = route;
    route = (url) => (url.endsWith("/api-key") ? "down" : base(url));
    await expect(srv.apipayIssueKey("b1", false, "op")).rejects.toThrow(/мог пройти/);
    expect(calls.filter((c) => c.url.endsWith("/api-key"))).toHaveLength(1);
    expect(settings).toEqual({});
  });

  it("клиент v1 — ApiPay не трогаем", async () => {
    tenantSettings = { served_by: "v1", apipay: { org_id: "9" } };
    await expect(srv.apipayIssueKey("b1", true, "op")).rejects.toThrow(/v1/);
    expect(calls).toEqual([]);
  });
});

describe("отметка неидемпотентного вызова", () => {
  it("зависшая старше 2 минут снимается, свежая — нет", async () => {
    db.tables.operator_settings!.push({ key: "apipay_lock:b1", value: String(1_000) });
    await expect(
      srv.withApipayLock(
        "b1",
        async () => 1,
        () => 1_000 + 60_000,
      ),
    ).rejects.toThrow(/ещё идёт/);
    expect(
      await srv.withApipayLock(
        "b1",
        async () => 2,
        () => 1_000 + 3 * 60_000,
      ),
    ).toBe(2);
  });
});

describe("организация и кассир", () => {
  it("организация создаётся один раз и запоминается у клиента", async () => {
    tenantSettings = { served_by: "v2" };
    route = () => ({ status: 201, body: { organization: { id: 42 } } });
    expect(await srv.apipayCreateOrg("b1", "op")).toBe("42");
    expect(tenantSettings.apipay).toEqual({ org_id: "42" });
    expect(await srv.apipayCreateOrg("b1", "op")).toBe("42");
    expect(calls.filter((c) => c.url.endsWith("/organizations"))).toHaveLength(1);
  });

  it("неверный код из SMS — понятный отказ", async () => {
    route = () => ({ status: 200, body: { success: false, error_code: "invalid_otp" } });
    await expect(srv.apipayVerifyCashier("b1", "0001", "op")).rejects.toThrow(
      "неверный код из SMS (invalid_otp)",
    );
    expect(events).toEqual([]);
  });

  it("номер кассира уходит в формате 7XXXXXXXXXX после init", async () => {
    route = () => ({ status: 200, body: { process_status: "ok" } });
    await srv.apipaySendCashierPhone("b1", "8 777 000 00 10", "op");
    expect(calls.map((c) => c.url.split("/").slice(-1)[0])).toEqual(["init", "send-phone"]);
    expect(calls[1]!.body).toEqual({ cashier_phone: "77770000010" });
  });
});
