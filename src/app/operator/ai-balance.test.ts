import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * Ручная поправка ИИ-баланса оператором: только клиенту v2 (правило 6), с
 * обязательной причиной — её видит продавец в журнале.
 */
let db: FakeDb;
let settings: Record<string, unknown> = {};
const BOT = "00000000-0000-0000-0000-0000000000b2";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  requireTenant: async () => ({ id: BOT, settings, modules: {}, ownerTelegramId: 42 }),
  tenantContext: (tenant: unknown) => ({ tenant, db }),
}));

const { adjustAiBalance } = await import("./ai-balance.server");
const row = (prefix: string) =>
  db.tables.app_settings!.filter((r) => String(r.key).startsWith(prefix));

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.zernio_logs = [];
  settings = { served_by: "v2" };
});

describe("поправка ИИ-баланса оператором", () => {
  it("клиенту v2 — начислено, в журнале причина и кто", async () => {
    expect(await adjustAiBalance(BOT, 2, " перевод вне счёта ", "operator:admin_a")).toMatchObject({
      usd: 7,
    });
    const adjust = row("ai_ledger:")
      .map((r) => JSON.parse(String(r.value)))
      .find((e) => e.kind === "adjust");
    expect(adjust).toMatchObject({ usd: 2, note: "перевод вне счёта", actor: "operator:admin_a" });
  });

  it("клиент прежней платформы — отказ, баланс не создаётся", async () => {
    settings = {};
    await expect(adjustAiBalance(BOT, 2, "компенсация", "operator:admin_a")).rejects.toThrow(
      /прежней платформе/,
    );
    expect(db.tables.app_settings).toHaveLength(0);
  });

  it("без причины — отказ; снять больше остатка — отказ", async () => {
    await expect(adjustAiBalance(BOT, 2, "  ", "operator:admin_a")).rejects.toThrow(/причину/);
    await expect(adjustAiBalance(BOT, -100, "ошибка", "operator:admin_a")).rejects.toThrow(
      /больше остатка/,
    );
    expect(row("ai_ledger:").map((r) => JSON.parse(String(r.value)).kind)).toEqual(["start"]);
  });
});
