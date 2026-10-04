import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/** Комиссия у оператора: выключатель и дата начала клиента (запись в settings без потери чужих ключей, журнал). */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));
vi.mock("@/core/tenant/resolve.server", async (orig) => {
  const real = await orig<typeof import("@/core/tenant/resolve.server")>();
  return {
    ...real,
    requireTenant: async () => {
      const raw = db.tables.bots![0]!.settings as Record<string, unknown>;
      const { settingsFromJson } = await import("@/core/tenant/directory");
      return { id: "b1", name: "Лавка", settings: settingsFromJson(raw) };
    },
  };
});

const { commissionSwitchView, switchCommission, setCommissionStart } =
  await import("./commission.server");

type Saved = { slug?: string; commission?: { start?: string } };
const saved = () => db.tables.bots![0]!.settings as Saved;

beforeEach(() => {
  db = fakeDb();
  db.tables.operator_settings = [];
  db.tables.bots = [{ id: "b1", settings: { served_by: "v2", slug: "shop", rev: 1 } }];
  db.tables.bot_events = [];
});

describe("общий выключатель", () => {
  it("по умолчанию выключен; общая дата начала — 1 января", async () => {
    expect(await commissionSwitchView()).toEqual({ enabled: false, defaultStart: "2027-01-01" });
    await switchCommission(true);
    expect((await commissionSwitchView()).enabled).toBe(true);
  });
});

describe("дата начала у клиента", () => {
  it("пишется в settings.commission.start, чужие ключи целы, в журнал — от и до", async () => {
    await setCommissionStart("b1", "2027-03-01", "operator:яков");
    expect(saved()).toMatchObject({ slug: "shop", commission: { start: "2027-03-01" } });
    expect(db.tables.bot_events![0]).toMatchObject({
      bot_id: "b1",
      actor: "operator:яков",
      payload: { action: "commission_start", from: null, to: "2027-03-01" },
    });
  });
  it("«вернуть общую дату» убирает ключ; повтор того же — без записи в журнал", async () => {
    await setCommissionStart("b1", "2027-03-01", "o");
    await setCommissionStart("b1", null, "o");
    expect(saved().commission?.start).toBeUndefined();
    expect(saved().slug).toBe("shop");
    const events = db.tables.bot_events!.length;
    await setCommissionStart("b1", null, "o");
    expect(db.tables.bot_events!.length).toBe(events);
  });
});
