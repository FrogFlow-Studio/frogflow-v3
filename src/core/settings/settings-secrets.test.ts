import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { setEnvForTests } from "@/config/env";
import { encryptSecret, isEncryptedSecret } from "@/core/secrets/vault";

const reported: Array<{ where: string; key: unknown }> = [];
vi.mock("@/lib/errors", () => ({
  reportError: vi.fn(async (_e: Error, c: { where: string; extra?: Record<string, unknown> }) => {
    reported.push({ where: c.where, key: c.extra?.key });
  }),
}));

const { setSetting, getSetting, getSettings, getSettingsStrict, getSettingStrict } =
  await import("./settings");
const { robokassaFor, prodamusFor } = await import("@/core/payments/payment");

const BOT = "11111111-1111-1111-1111-111111111111";
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

function ctxWith(db: ReturnType<typeof fakeDb>, modules: Record<string, boolean> = {}) {
  return { tenant: { id: BOT, modules }, db } as unknown as TenantContext;
}

const stored = (db: ReturnType<typeof fakeDb>, key: string) =>
  (db.tables.app_settings ?? []).find((r) => r.key === key)?.value as string | undefined;

beforeEach(() => {
  reported.length = 0;
  setEnvForTests({ SECRETS_KEY: KEY });
});
afterAll(() => setEnvForTests(undefined));

describe("ключи платёжек в app_settings", () => {
  it("setSetting пишет ключ Prodamus зашифрованным, getSetting отдаёт открытый", async () => {
    const db = fakeDb();
    const ctx = ctxWith(db);
    await setSetting(ctx, "prodamus_secret_key", "sk-live-123");
    expect(isEncryptedSecret(stored(db, "prodamus_secret_key"))).toBe(true);
    expect(stored(db, "prodamus_secret_key")).not.toContain("sk-live-123");
    expect(await getSetting(ctx, "prodamus_secret_key")).toBe("sk-live-123");
  });

  it("обычные настройки и пустой пароль пишутся как есть", async () => {
    const db = fakeDb();
    const ctx = ctxWith(db);
    await setSetting(ctx, "shop_currency", "KZT");
    await setSetting(ctx, "robokassa_pass1_test", "");
    expect(stored(db, "shop_currency")).toBe("KZT");
    expect(stored(db, "robokassa_pass1_test")).toBe("");
  });

  it("старый открытый пароль читается и при чтении перезаписывается зашифрованным", async () => {
    const db = fakeDb();
    db.tables.app_settings = [
      { bot_id: BOT, key: "robokassa_pass1", value: "plain-pass-1", updated_at: "2026-10-01" },
      { bot_id: BOT, key: "robokassa_login", value: "kopilka", updated_at: "2026-10-01" },
    ];
    const ctx = ctxWith(db);
    const s = await getSettingsStrict(ctx, ["robokassa_pass1", "robokassa_login"]);
    expect(s).toEqual({ robokassa_pass1: "plain-pass-1", robokassa_login: "kopilka" });
    expect(isEncryptedSecret(stored(db, "robokassa_pass1"))).toBe(true);
    expect(stored(db, "robokassa_login")).toBe("kopilka");
    // Метка «изменено недавно» не сдвигается: продавец ничего не менял.
    expect(db.tables.app_settings![0]!.updated_at).toBe("2026-10-01");
    expect(await getSettingStrict(ctx, "robokassa_pass1")).toBe("plain-pass-1");
    expect(reported).toEqual([]);
  });

  it("продавец сменил ключ, пока шло чтение, — новое значение не затирается", async () => {
    const db = fakeDb();
    db.tables.app_settings = [{ bot_id: BOT, key: "prodamus_secret_key", value: "old" }];
    const ctx = ctxWith(db);
    const realFrom = db.from.bind(db);
    let calls = 0;
    (db as { from: unknown }).from = (t: string) => {
      // Второе обращение — запись шифрованного значения; перед ней продавец
      // успел сохранить новый ключ.
      if (t === "app_settings" && ++calls === 2)
        db.tables.app_settings![0]!.value = "new-by-seller";
      return realFrom(t);
    };
    await getSettings(ctx, ["prodamus_secret_key"]);
    expect(stored(db, "prodamus_secret_key")).toBe("new-by-seller");
  });

  it("строгое чтение: ключ, зашифрованный чужим SECRETS_KEY, — сбой, а не пустой ключ", async () => {
    const db = fakeDb();
    db.tables.app_settings = [
      { bot_id: BOT, key: "robokassa_pass2", value: encryptSecret("p2", OTHER_KEY) },
    ];
    const ctx = ctxWith(db);
    await expect(getSettingsStrict(ctx, ["robokassa_pass2"])).rejects.toThrow();
    expect(await getSettings(ctx, ["robokassa_pass2"])).toEqual({});
    expect(reported).toEqual([{ where: "settings.open", key: "robokassa_pass2" }]);
  });

  it("настоящий путь оплаты: Robokassa и Prodamus работают на зашифрованных ключах", async () => {
    const db = fakeDb();
    const ctx = ctxWith(db, { robokassa: true, prodamus: true });
    for (const [k, v] of Object.entries({
      robokassa_enabled: "true",
      robokassa_login: "kopilka",
      robokassa_pass1: "pass-one",
      robokassa_pass2: "pass-two",
      robokassa_region: "kz",
      prodamus_enabled: "true",
      prodamus_form_url: "https://kopilka.payform.ru",
      prodamus_secret_key: "prod-secret",
      prodamus_currency: "RUB",
    }))
      await setSetting(ctx, k, v);
    expect(isEncryptedSecret(stored(db, "robokassa_pass2"))).toBe(true);
    const rk = await robokassaFor(ctx);
    expect(rk).toMatchObject({ ready: true, pass1: "pass-one", pass2: "pass-two" });
    const pd = await prodamusFor(ctx);
    expect(pd).toMatchObject({ ready: true, secretKey: "prod-secret" });
  });
});
