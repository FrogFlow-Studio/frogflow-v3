import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { consumeLoginToken, issueLoginToken, TG_LOGIN_TTL_MS } from "./tg-login.server";

const BOT = "00000000-0000-0000-0000-00000000007a";
let db: FakeDb;
let ctx: TenantContext;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  ctx = { db, tenant: { id: BOT } } as unknown as TenantContext;
});

describe("вход владельца через Telegram", () => {
  it("ссылка входит один раз; в базе только хеш токена", async () => {
    const token = await issueLoginToken(ctx, "anna", 1000);
    expect(JSON.stringify(db.tables.app_settings)).not.toContain(token);
    expect(await consumeLoginToken(ctx, token, 2000)).toBe("anna");
    expect(await consumeLoginToken(ctx, token, 2000)).toBeNull();
  });

  it("просроченная, чужая и кривая ссылка не входят", async () => {
    const token = await issueLoginToken(ctx, "anna", 1000);
    expect(await consumeLoginToken(ctx, token, 1000 + TG_LOGIN_TTL_MS + 1)).toBeNull();
    expect(await consumeLoginToken(ctx, "a".repeat(48), 1000)).toBeNull();
    expect(await consumeLoginToken(ctx, "../../x", 1000)).toBeNull();
  });
});
