import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Две правки bots.settings в один миг (владелец и приглашённый, оператор и
 * продавец, крон и вебхук): ни одна не должна стереть чужой ключ. Настоящие
 * функции записи на общей фальшивой базе; каждая запись условна по settings.rev.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));

const { patchTenantSettings, updateAdminSettings, invalidateTenantDirectory } =
  await import("./resolve.server");

const BOT = "00000000-0000-4000-8000-0000000000bb";
type Settings = {
  admin: { users: unknown[] };
  notify_read?: unknown;
  commission?: unknown;
  rev?: number;
};
const settings = () => db.tables.bots![0]!.settings as Settings;

beforeEach(() => {
  invalidateTenantDirectory();
  db = fakeDb();
  db.tables.bots = [
    {
      id: BOT,
      settings: {
        rev: 7,
        served_by: "v2",
        slug: "lavka",
        // Ключ прежней платформы, которого v2 не знает: терять нельзя.
        on_overdue: "suspend",
        admin: { username: "owner", password_hash: "scrypt$a$b", users: [] },
      },
    },
  ];
});

const addUser = (name: string) =>
  updateAdminSettings(BOT, (a) => ({
    ...a,
    users: [
      ...((a.users as unknown[]) ?? []),
      { username: name, password_hash: "scrypt$c$d", role: "manager" },
    ],
  }));

describe("гонки записи bots.settings", () => {
  it("принятие приглашения и отметка «прочитано» в один миг: пользователь и отметка на месте", async () => {
    await Promise.all([
      addUser("kate"),
      patchTenantSettings(BOT, { notify_read: { "admin:owner": "2026-10-04T10:00:00.000Z" } }),
    ]);
    expect((settings().admin.users as unknown[]).length).toBe(1);
    expect(settings().notify_read).toEqual({ "admin:owner": "2026-10-04T10:00:00.000Z" });
    expect(settings()).toMatchObject({ served_by: "v2", slug: "lavka", on_overdue: "suspend" });
  });

  it("три разных правки одновременно: все три в итоге, версия выросла на три", async () => {
    await Promise.all([
      addUser("kate"),
      addUser("anna"),
      patchTenantSettings(BOT, { commission: { start: "2027-01-01" } }),
    ]);
    expect((settings().admin.users as unknown[]).length).toBe(2);
    expect(settings().commission).toEqual({ start: "2027-01-01" });
    expect(settings().rev).toBe(10);
  });

  it("две правки одного вложенного ключа не теряют соседей по ключу", async () => {
    await Promise.all([
      patchTenantSettings(BOT, { notify_read: { "admin:a": "2026-10-04T10:00:00.000Z" } }),
      patchTenantSettings(BOT, { notify_read: { "admin:b": "2026-10-04T11:00:00.000Z" } }),
    ]);
    expect(settings().notify_read).toEqual({
      "admin:a": "2026-10-04T10:00:00.000Z",
      "admin:b": "2026-10-04T11:00:00.000Z",
    });
  });
});
