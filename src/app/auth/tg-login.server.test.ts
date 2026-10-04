import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  claimLoginRequest,
  consumeLoginToken,
  issueLoginToken,
  TG_LOGIN_MAX_PER_HOUR,
  TG_LOGIN_TTL_MS,
} from "./tg-login.server";

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

describe("предел ссылок входа на магазин", () => {
  it("шестая ссылка за час не выдаётся, через час снова можно", async () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < TG_LOGIN_MAX_PER_HOUR; i++)
      expect(await claimLoginRequest(ctx, t0 + i * 1000)).toBe(true);
    expect(await claimLoginRequest(ctx, t0 + 10_000)).toBe(false);
    expect(await claimLoginRequest(ctx, t0 + 3_600_000 + 10_000)).toBe(true);
  });

  it("запросы разом не проходят сверх предела", async () => {
    const t0 = 1_700_000_000_000;
    const r = await Promise.all(Array.from({ length: 12 }, () => claimLoginRequest(ctx, t0)));
    expect(r.filter(Boolean).length).toBeLessThanOrEqual(TG_LOGIN_MAX_PER_HOUR);
    expect(r.filter(Boolean).length).toBeLessThanOrEqual(TG_LOGIN_MAX_PER_HOUR);
  });

  it("счёт у каждого магазина свой", async () => {
    const other = {
      db,
      tenant: { id: "00000000-0000-0000-0000-00000000008b" },
    } as unknown as TenantContext;
    for (let i = 0; i < TG_LOGIN_MAX_PER_HOUR; i++)
      await claimLoginRequest(ctx, 1_700_000_000_000 + i);
    expect(await claimLoginRequest(other, 1_700_000_000_000 + 9)).toBe(true);
  });
});

describe("запрос ссылки входа", () => {
  it("шестой запрос честно «limited», ссылки пятью разошлись, пароль не заперт", async () => {
    const { requestTgLogin } = await import("./tg-login-request.server");
    db.tables.admin_login_attempts = [];
    const sent: string[] = [];
    const out: string[] = [];
    for (let i = 0; i < 6; i++)
      out.push(await requestTgLogin(ctx, "anna", async (t) => void sent.push(t)));
    expect(out).toEqual(["sent", "sent", "sent", "sent", "sent", "limited"]);
    expect(sent).toHaveLength(5);
    expect(db.tables.admin_login_attempts).toHaveLength(0);
  });
});
