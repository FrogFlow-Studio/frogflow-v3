import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { base32Decode, hotp, totpCode, totpStep } from "@/core/auth/totp";
import { setEnvForTests } from "@/config/env";

/**
 * Двухшаговый вход оператора на базе в памяти. Главное — оператор не может
 * запереть себя: защита включается только верным кодом, резервные коды
 * выдаются сразу и работают по одному разу.
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const tf = await import("./two-factor.server");
const { TOTP_KEYS } = tf;

const T0 = 1_800_000_000_000;
const rows = () => db.tables.operator_settings ?? [];
const value = (key: string) => rows().find((r) => r.key === key)?.value as string | undefined;

beforeEach(() => {
  setEnvForTests({});
  db = fakeDb({ unique: { operator_settings: [["key"]] } });
  db.tables.operator_settings = [{ key: "operator_username", value: "admin_a" }];
});

async function enable(now = T0) {
  const { secret } = await tf.startTwoFactorSetup("admin_a", now);
  const codes = await tf.confirmTwoFactorSetup(totpCode(secret, now), now);
  return { secret, codes };
}

describe("включение двухшагового входа", () => {
  it("по умолчанию выключен: вход без кода, как раньше", async () => {
    expect(await tf.twoFactorStatus()).toEqual({ enabled: false, backupLeft: 0 });
    expect(await tf.verifySecondFactor(undefined, T0)).toBe("none");
  });

  it("начатое, но не подтверждённое включение вход не меняет", async () => {
    const { secret, uri, qrSvg } = await tf.startTwoFactorSetup("admin_a", T0);
    expect(uri).toContain(`secret=${secret}`);
    expect(qrSvg).toContain("<svg");
    expect((await tf.twoFactorStatus()).enabled).toBe(false);
    expect(await tf.verifySecondFactor(undefined, T0)).toBe("none");
    // Секрет в базе только зашифрованным.
    expect(value(TOTP_KEYS.pending)).not.toContain(secret);
  });

  it("неверный код не включает защиту", async () => {
    await tf.startTwoFactorSetup("admin_a", T0);
    await expect(tf.confirmTwoFactorSetup("000000", T0)).rejects.toThrow("Код не подошёл");
    expect((await tf.twoFactorStatus()).enabled).toBe(false);
  });

  it("устаревшее включение не подтверждается — нужно начать заново", async () => {
    const { secret } = await tf.startTwoFactorSetup("admin_a", T0);
    const later = T0 + 16 * 60_000;
    await expect(tf.confirmTwoFactorSetup(totpCode(secret, later), later)).rejects.toThrow(
      "Время на включение вышло",
    );
  });

  it("верный код включает и сразу выдаёт 10 резервных кодов; в базе только хэши", async () => {
    const { secret, codes } = await enable();
    expect(codes).toHaveLength(10);
    expect(await tf.twoFactorStatus()).toEqual({ enabled: true, backupLeft: 10 });
    expect(value(TOTP_KEYS.pending)).toBeUndefined();
    expect(value(TOTP_KEYS.secret)).toMatch(/^enc:v1:/);
    const stored = JSON.stringify(rows());
    expect(stored).not.toContain(secret);
    for (const c of codes) expect(stored).not.toContain(c);
  });
});

describe("двойное подтверждение", () => {
  it("два подтверждения разом: включает одно, коды на экране — рабочие", async () => {
    const { secret } = await tf.startTwoFactorSetup("admin_a", T0);
    const code = totpCode(secret, T0);
    const res = await Promise.allSettled([
      tf.confirmTwoFactorSetup(code, T0),
      tf.confirmTwoFactorSetup(code, T0),
    ]);
    const ok = res.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const codes = (ok[0] as PromiseFulfilledResult<string[]>).value;
    expect(await tf.verifySecondFactor(codes[0]!, T0 + 60_000)).toBe("backup");
  });
});

describe("вход со вторым шагом", () => {
  it("без кода и с неверным кодом — нет; с кодом из приложения — да, но один раз", async () => {
    const { secret } = await enable();
    const now = T0 + 60_000;
    expect(await tf.verifySecondFactor(undefined, now)).toBeNull();
    expect(await tf.verifySecondFactor("123456", now)).toBeNull();
    const code = totpCode(secret, now);
    expect(await tf.verifySecondFactor(code, now)).toBe("totp");
    expect(await tf.verifySecondFactor(code, now)).toBeNull();
  });

  it("код, которым включали, для входа уже не годится", async () => {
    const { secret } = await enable();
    expect(await tf.verifySecondFactor(totpCode(secret, T0), T0)).toBeNull();
  });

  it("резервный код пускает один раз и уменьшает остаток", async () => {
    const { codes } = await enable();
    expect(await tf.verifySecondFactor(codes[3]!.toLowerCase(), T0)).toBe("backup");
    expect(await tf.verifySecondFactor(codes[3]!, T0)).toBeNull();
    expect((await tf.twoFactorStatus()).backupLeft).toBe(9);
  });

  it("выключение и новые коды — только с верным кодом", async () => {
    const { secret, codes } = await enable();
    // Неверный код — BadSecondFactor: его функции панели пишут в замок входа.
    await expect(tf.disableTwoFactor("111111", T0 + 60_000)).rejects.toBeInstanceOf(
      tf.BadSecondFactor,
    );
    await expect(tf.regenerateBackupCodes("111111", T0 + 60_000)).rejects.toBeInstanceOf(
      tf.BadSecondFactor,
    );
    expect((await tf.twoFactorStatus()).enabled).toBe(true);

    const fresh = await tf.regenerateBackupCodes(totpCode(secret, T0 + 60_000), T0 + 60_000);
    expect(fresh).toHaveLength(10);
    expect(await tf.verifySecondFactor(codes[0]!, T0 + 60_000)).toBeNull();

    await tf.disableTwoFactor(fresh[0]!, T0 + 120_000);
    expect(await tf.twoFactorStatus()).toEqual({ enabled: false, backupLeft: 0 });
    // Строки двухшагового входа удалены; остаётся учётка и новая эпоха сессий.
    expect(rows().map((r) => r.key)).toEqual(["operator_username", "operator_session_epoch"]);
    expect(await tf.verifySecondFactor(undefined, T0)).toBe("none");
  });

  it("часы телефона отстают на шаг — код ещё принимается", async () => {
    const { secret } = await enable();
    const now = T0 + 10 * 60_000;
    const prev = hotp(base32Decode(secret), totpStep(now) - 1);
    expect(await tf.verifySecondFactor(prev, now)).toBe("totp");
  });
});

describe("сессии оператора", () => {
  it("пока ни разу не включали — отпечаток прежний; включение и выключение гасят прежние сессии", async () => {
    const { operatorStamp } = await import("./credentials.server");
    const { credentialStamp } = await import("@/app/auth/session.server");
    db.tables.operator_settings!.push({ key: "operator_password_hash", value: "scrypt:a:b" });
    const before = await operatorStamp();
    // Тот же отпечаток, что до появления двухшагового входа: деплой никого не выкидывает.
    expect(before).toBe(credentialStamp("db", "admin_a", "scrypt:a:b"));
    const { secret } = await enable();
    const on = await operatorStamp();
    expect(on).not.toBe(before);
    await tf.disableTwoFactor(totpCode(secret, T0 + 60_000), T0 + 60_000);
    const off = await operatorStamp();
    // Cookie, выданная до включения, после выключения не оживает, как и выданная при включённом.
    expect(off).not.toBe(before);
    expect(off).not.toBe(on);
    // Повторное включение и выключение — каждый раз новая эпоха.
    const again = await enable();
    const on2 = await operatorStamp();
    expect(new Set([before, on, off, on2]).size).toBe(4);
    await tf.disableTwoFactor(totpCode(again.secret, T0 + 120_000), T0 + 120_000);
    expect(new Set([before, on, off, on2, await operatorStamp()]).size).toBe(5);
  });

  it("восстановление по docs (удалить четыре ключа, эпоху оставить) гасит все прежние сессии", async () => {
    const { operatorStamp } = await import("./credentials.server");
    db.tables.operator_settings!.push({ key: "operator_password_hash", value: "scrypt:a:b" });
    const before = await operatorStamp();
    await enable();
    const on = await operatorStamp();
    const keys: string[] = Object.values(tf.TOTP_KEYS);
    db.tables.operator_settings = db.tables.operator_settings!.filter(
      (r) => !keys.includes(String(r.key)),
    );
    expect(db.tables.operator_settings.some((r) => r.key === "operator_session_epoch")).toBe(true);
    const recovered = await operatorStamp();
    expect(recovered).not.toBe(before);
    expect(recovered).not.toBe(on);
  });
});
