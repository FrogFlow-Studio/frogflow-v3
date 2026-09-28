import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";

// Партнёры агентств: хранение в operator_settings, привязка клиента, отчёт по ссылке.
const db = fakeDb({ unique: { operator_settings: [["key"]] } });
const patched: Array<[string, Record<string, unknown>]> = [];
let tenants: Array<Record<string, unknown>> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/config/env", () => ({ env: () => ({ SESSION_SECRET: "s".repeat(40) }) }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  patchTenantSettings: async (id: string, p: Record<string, unknown>) => void patched.push([id, p]),
}));

const srv = await import("./partners.server");
const { partnerToken } = await import("@/core/partners/partners");

beforeEach(() => {
  db.tables.operator_settings = [];
  db.tables.subscription_payments = [
    { id: 1, bot_id: "b1", paid_at: new Date().toISOString(), amount: 10000, currency: "KZT" },
    { id: 2, bot_id: "b2", paid_at: new Date().toISOString(), amount: 50000, currency: "KZT" },
  ];
  patched.length = 0;
  tenants = [
    { id: "b1", name: "Свой", plan: null, archived: false, settings: { partner: "agency" } },
    { id: "b2", name: "Чужой", plan: null, archived: false, settings: {} },
  ];
});

describe("партнёры: хранение и доступ", () => {
  it("сохраняет и обновляет партнёра по коду, мусор отклоняет", async () => {
    await srv.savePartner({ code: "agency", name: "Агентство", contact: "@a", percent: 20 });
    await srv.savePartner({ code: "agency", name: "Агентство 2", contact: "", percent: 25 });
    expect(await srv.loadPartners()).toEqual([
      { code: "agency", name: "Агентство 2", contact: "", percent: 25 },
    ]);
    await expect(srv.savePartner({ code: "!", name: "x", percent: 1 })).rejects.toThrow();
  });

  it("регистрация по ссылке берёт только существующий код", async () => {
    await srv.savePartner({ code: "agency", name: "A", contact: "", percent: 20 });
    expect(await srv.partnerForSignup("AGENCY")).toBe("agency");
    expect(await srv.partnerForSignup("nope")).toBeNull();
    expect(await srv.partnerForSignup(undefined)).toBeNull();
    await expect(srv.setClientPartner("b2", "nope")).rejects.toThrow("Нет такого партнёра");
    await srv.setClientPartner("b2", "agency");
    await srv.setClientPartner("b2", null);
    expect(patched).toEqual([
      ["b2", { partner: "agency" }],
      ["b2", { partner: null }],
    ]);
  });

  it("партнёра с клиентами не удалить", async () => {
    await srv.savePartner({ code: "agency", name: "A", contact: "", percent: 20 });
    await expect(srv.deletePartner("agency")).rejects.toThrow("есть клиенты");
    tenants = [];
    await srv.deletePartner("agency");
    expect(await srv.loadPartners()).toEqual([]);
  });

  it("отчёт по ссылке — только по верной подписи, свои клиенты, без контакта", async () => {
    await srv.savePartner({ code: "agency", name: "A", contact: "+7 700", percent: 20 });
    expect(await srv.partnerPublicReport("agency", "подделка")).toBeNull();
    const r = await srv.partnerPublicReport("agency", partnerToken("s".repeat(40), "agency"));
    expect(r!.clients.map((c) => c.name)).toEqual(["Свой"]);
    expect(r!.totals).toEqual([{ currency: "KZT", paid: 10000, commission: 2000 }]);
    expect(r!.partner.contact).toBe("");
  });
});
