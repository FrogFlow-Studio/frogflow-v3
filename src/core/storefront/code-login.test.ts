import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import {
  checkLoginCode,
  issueLoginCode,
  LOGIN_CODE_TTL_MS,
  LOGIN_MAX_TRIES,
  LOGIN_REISSUE_MS,
  newLoginNonce,
  nonceFromMessage,
  nonceFromPayload,
} from "./code-login";

const SECRET = "test-secret-test-secret-test-secret";
const BOT = "bot-1";
const NOW = Date.parse("2026-10-04T10:00:00Z");

function setup() {
  const db = fakeDb();
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: "telegram_7",
      telegram_id: 7,
      platform: "telegram",
      state: {},
    },
    {
      id: "u2",
      bot_id: BOT,
      user_key: "telegram_8",
      telegram_id: 8,
      platform: "telegram",
      state: {},
    },
  ];
  const ctx = { tenant: { id: BOT }, db } as unknown as TenantContext;
  const who = (n: number) => ({ userKey: `telegram_${n}`, telegramId: n }) as Customer;
  const stored = (n: number) =>
    (db.tables.bot_users!.find((r) => r.telegram_id === n)!.state as Record<string, unknown>)
      .web_login as Record<string, unknown> | undefined;
  return { ctx, db, who, stored };
}

async function issue(s: ReturnType<typeof setup>, n = 7, nonce = newLoginNonce(), at = NOW) {
  const r = await issueLoginCode(s.ctx, SECRET, s.who(n), nonce, at);
  if (!r.ok) throw new Error(r.reason);
  return { nonce, code: r.code };
}

describe("вход по коду: выдача", () => {
  it("код шестизначный, в базе — только отпечатки, без кода и метки", async () => {
    const s = setup();
    const { nonce, code } = await issue(s);
    expect(code).toMatch(/^\d{6}$/);
    const w = s.stored(7)!;
    expect(JSON.stringify(w)).not.toContain(code);
    expect(JSON.stringify(w)).not.toContain(nonce);
    expect(w.exp).toBe(NOW + LOGIN_CODE_TTL_MS);
  });

  it("метка не по формату — отказ, запись не создаётся", async () => {
    const s = setup();
    expect(await issueLoginCode(s.ctx, SECRET, s.who(7), "short", NOW)).toEqual({
      ok: false,
      reason: "bad_nonce",
    });
    expect(s.stored(7)).toBeUndefined();
  });

  it("тот же браузер просит код чаще раза в 30 секунд — «подождите», старый код жив", async () => {
    const s = setup();
    const { nonce, code } = await issue(s);
    expect(await issueLoginCode(s.ctx, SECRET, s.who(7), nonce, NOW + 5_000)).toEqual({
      ok: false,
      reason: "wait",
    });
    expect((await checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 6_000)).ok).toBe(true);
  });

  it("через 30 секунд — новый код, старый не действует", async () => {
    const s = setup();
    const first = await issue(s);
    const again = await issueLoginCode(
      s.ctx,
      SECRET,
      s.who(7),
      first.nonce,
      NOW + LOGIN_REISSUE_MS,
    );
    if (!again.ok) throw new Error("ожидали новый код");
    if (again.code !== first.code)
      expect(
        (await checkLoginCode(s.ctx, SECRET, first.nonce, first.code, NOW + LOGIN_REISSUE_MS + 1))
          .ok,
      ).toBe(false);
    expect(
      (await checkLoginCode(s.ctx, SECRET, first.nonce, again.code, NOW + LOGIN_REISSUE_MS + 2)).ok,
    ).toBe(true);
  });

  it("метка и «вход …» разбираются; чужое — нет", () => {
    const n = newLoginNonce();
    expect(nonceFromPayload(`lg_${n}`)).toBe(n);
    expect(nonceFromPayload(`wc_${n}`)).toBeNull();
    expect(nonceFromPayload("lg_коротко")).toBeNull();
    for (const w of ["вход", "кіру", "kirish", "login", "Вход"])
      expect(nonceFromMessage(`${w} ${n}`)).toBe(n);
    expect(nonceFromMessage(`привет ${n}`)).toBeNull();
    expect(nonceFromMessage(`вход ${n} лишнее`)).toBeNull();
  });
});

describe("вход по коду: проверка", () => {
  it("верный код пускает покупателя и ровно один раз", async () => {
    const s = setup();
    const { nonce, code } = await issue(s);
    expect(await checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 1000)).toEqual({
      ok: true,
      telegramId: 7,
    });
    expect(await checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 2000)).toEqual({
      ok: false,
      reason: "used",
    });
    expect(s.stored(7)!.used).toBe(true);
  });

  it("два одновременных ввода верного кода — вход получает один", async () => {
    const s = setup();
    const { nonce, code } = await issue(s);
    const r = await Promise.all([
      checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 1000),
      checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 1000),
      checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 1000),
    ]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });

  it("пять неверных попыток — дальше и верный код не пускает", async () => {
    const s = setup();
    const { nonce, code } = await issue(s);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i <= LOGIN_MAX_TRIES; i++) {
      const r = await checkLoginCode(s.ctx, SECRET, nonce, wrong, NOW + i);
      expect(r).toEqual({ ok: false, reason: "wrong", left: LOGIN_MAX_TRIES - i });
    }
    expect(await checkLoginCode(s.ctx, SECRET, nonce, code, NOW + 10)).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  it("через 10 минут код истёк", async () => {
    const s = setup();
    const { nonce, code } = await issue(s);
    expect(await checkLoginCode(s.ctx, SECRET, nonce, code, NOW + LOGIN_CODE_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await checkLoginCode(s.ctx, SECRET, nonce, code, NOW + LOGIN_CODE_TTL_MS)).toMatchObject(
      {
        ok: true,
      },
    );
  });

  it("чужая метка или код без метки: покупатель не найден, ничего не пишется", async () => {
    const s = setup();
    const { code } = await issue(s);
    const before = JSON.stringify(s.db.tables.bot_users);
    expect(await checkLoginCode(s.ctx, SECRET, newLoginNonce(), code, NOW + 1)).toEqual({
      ok: false,
      reason: "unknown",
    });
    expect(await checkLoginCode(s.ctx, SECRET, "", code, NOW + 1)).toMatchObject({ ok: false });
    expect(JSON.stringify(s.db.tables.bot_users)).toBe(before);
  });

  it("код другого покупателя с другой меткой не подходит", async () => {
    const s = setup();
    const a = await issue(s, 7);
    const b = await issue(s, 8);
    const other = a.code === b.code ? (a.code === "000000" ? "111111" : "000000") : b.code;
    expect((await checkLoginCode(s.ctx, SECRET, a.nonce, other, NOW + 1)).ok).toBe(false);
    expect(await checkLoginCode(s.ctx, SECRET, b.nonce, b.code, NOW + 2)).toMatchObject({
      ok: true,
      telegramId: 8,
    });
  });

  it("не шесть цифр — сразу отказ без обращения к базе", async () => {
    const s = setup();
    const { nonce } = await issue(s);
    for (const bad of ["12345", "1234567", "abcdef", "12 456"])
      expect(await checkLoginCode(s.ctx, SECRET, nonce, bad, NOW + 1)).toEqual({
        ok: false,
        reason: "unknown",
      });
    expect(s.stored(7)!.tries).toBe(0);
  });
});
