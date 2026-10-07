import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { settingsFromJson } from "@/core/tenant/directory";
import { pricelistDefaultFor } from "@/core/consultant/pricelist/mode";

/**
 * Новый клиент-консультант BOVI работает по прайсу сразу: флаг
 * consultant_pricelist.enabled ставится при создании и при смене ниши на
 * «consultant», если оператор его ещё не трогал.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
let directory: Array<Record<string, unknown>> = [];
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  tenantDirectory: async () => directory,
  invalidateTenantDirectory: () => {},
  patchTenantSettings: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    patches.push({ id, patch });
  }),
}));

const { createClient, updateClientMeta } = await import("./operator.server");

beforeEach(() => {
  db = fakeDb();
  db.tables.bots = [];
  db.tables.bot_events = [];
  patches.length = 0;
  directory = [];
});

describe("флаг «по прайсу» по умолчанию", () => {
  it("правило: только ниша consultant и только пока флаг не трогали", () => {
    expect(pricelistDefaultFor("consultant", undefined)).toEqual({ enabled: true });
    expect(pricelistDefaultFor("consultant", { enabled: false })).toBeNull();
    expect(pricelistDefaultFor("consultant_universal", undefined)).toBeNull();
    expect(pricelistDefaultFor("digital", undefined)).toBeNull();
  });

  it("новый клиент ниши «Консультант (ун. BOVI)» создаётся с флагом", async () => {
    const id = await createClient({ name: "BOVI 2", ownerId: "bovi2", vertical: "consultant" });
    const row = db.tables.bots!.find((r) => r.id === id)!;
    expect(settingsFromJson(row.settings as Record<string, unknown>).consultant_pricelist).toEqual({
      enabled: true,
    });
  });

  it("магазин создаётся без флага", async () => {
    const id = await createClient({ name: "Магазин", ownerId: "shop1", vertical: "digital" });
    const row = db.tables.bots!.find((r) => r.id === id)!;
    expect((row.settings as Record<string, unknown>).consultant_pricelist).toBeUndefined();
  });

  it("смена ниши на consultant включает флаг; выключенный оператором — не трогает", async () => {
    db.tables.bots = [
      { id: "b1", vertical: "digital", settings: {} },
      { id: "b2", vertical: "digital", settings: { consultant_pricelist: { enabled: false } } },
    ];
    directory = [
      { id: "b1", vertical: "digital", settings: settingsFromJson({}) },
      {
        id: "b2",
        vertical: "digital",
        settings: settingsFromJson({ consultant_pricelist: { enabled: false } }),
      },
    ];
    await updateClientMeta("b1", { vertical: "consultant" });
    await updateClientMeta("b2", { vertical: "consultant" });
    expect(patches).toEqual([{ id: "b1", patch: { consultant_pricelist: { enabled: true } } }]);
    // Ниша не менялась (переименование) — флаг не ставим.
    await updateClientMeta("b1", { name: "Новое имя" });
    expect(patches).toHaveLength(1);
  });
});
