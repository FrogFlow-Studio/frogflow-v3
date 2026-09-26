import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const { claimChallenge, CHALLENGE_PREFIX } = await import("./signup.server");

const NOW = Date.parse("2026-09-26T12:00:00Z");

beforeEach(() => {
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  db.tables.operator_settings = [];
});

describe("регистрация: одно решение задачи — один магазин", () => {
  it("две одновременные отправки с одним решением — проходит одна", async () => {
    const res = await Promise.all(Array.from({ length: 5 }, () => claimChallenge("n1", NOW)));
    expect(res.filter((r) => r === null)).toHaveLength(1);
    expect(res.filter((r) => r?.includes("устарела"))).toHaveLength(4);
  });

  it("другое решение не мешает, просроченные брони подчищаются", async () => {
    db.tables.operator_settings = [
      { key: `${CHALLENGE_PREFIX}old`, value: new Date(NOW - 1000).toISOString() },
      { key: "session_revoked:x", value: new Date(NOW - 1000).toISOString() },
    ];
    expect(await claimChallenge("n2", NOW)).toBeNull();
    expect(db.tables.operator_settings.map((r) => r.key).sort()).toEqual([
      "session_revoked:x",
      `${CHALLENGE_PREFIX}n2`,
    ]);
  });

  it("сбой базы — отказ, а не регистрация", async () => {
    db.from = () =>
      ({
        insert: async () => ({ error: { code: "08006", message: "down" } }),
      }) as never;
    expect(await claimChallenge("n3", NOW)).toMatch(/временно недоступна/);
  });
});
