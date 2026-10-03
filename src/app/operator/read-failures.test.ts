import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { withBrokenReads } from "../../../tests/broken-db";

// Сбой чтения базы у оператора — ошибка, а не «данных нет»: иначе вход оператора
// молча уходит на пароль из окружения, а включение модуля затирает остальные модули.
let db = fakeDb();
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/config/env", () => ({
  env: () => ({ OPERATOR_USERNAME: "env_admin", OPERATOR_PASSWORD: "env-pass" }),
}));

const creds = await import("./credentials.server");
const billing = await import("./billing.server");

beforeEach(() => {
  db = fakeDb();
  db.tables.operator_settings = [
    { key: "operator_username", value: "db_admin" },
    { key: "operator_password_hash", value: "hash" },
  ];
});

describe("сбой чтения настроек оператора", () => {
  it("учётные данные не прочитались — ошибка, а не вход по паролю из окружения", async () => {
    db = withBrokenReads(db, ["operator_settings"]);
    await expect(creds.operatorCredentialsSource()).rejects.toThrow(/учётные данные не прочитаны/);
    await expect(creds.verifyOperator("env_admin", "env-pass")).rejects.toThrow();
  });

  it("реквизиты и ссылка Kaspi не прочитались — ошибка, а не пустая строка", async () => {
    db = withBrokenReads(db, ["operator_settings"]);
    await expect(billing.getPayoutRequisites()).rejects.toThrow(/реквизиты не прочитаны/);
    await expect(billing.getKaspiPayLink()).rejects.toThrow(/Kaspi Pay не прочитана/);
  });
});

describe("сбой чтения модулей клиента", () => {
  it("модули не прочитались — ошибка, остальные модули клиента не затёрты", async () => {
    vi.resetModules();
    vi.doMock("@/core/tenant/resolve.server", async (orig) => ({
      ...(await orig<object>()),
      tenantDirectory: async () => [],
      invalidateTenantDirectory: () => {},
    }));
    db = fakeDb();
    db.tables.bots = [{ id: "b1", modules: { shop: true, vip: true } }];
    const before = JSON.stringify(db.tables.bots);
    db = withBrokenReads(db, ["bots"]);
    const { setModule } = await import("./operator.server");
    await expect(setModule("b1", "shop", false)).rejects.toThrow(/модули клиента не прочитаны/);
    expect(JSON.stringify((db as unknown as { tables: Record<string, unknown> }).tables.bots)).toBe(
      before,
    );
  });
});
