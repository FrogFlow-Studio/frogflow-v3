import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { activeDeliveryZones, amountDueNow } from "@/core/fulfillment/fulfillment";
import { getSetting, getSettings, getSettingStrict, getSettingsStrict } from "./settings";

vi.mock("@/config/env", () => ({ env: () => ({ ANTHROPIC_API_KEY: "k" }) }));
const reported = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/errors", () => ({ reportError: (...a: unknown[]) => reported(...a) }));

const BOT = "00000000-0000-0000-0000-000000000001";

/** Запросы к `table` отвечают ошибкой базы, остальные идут в подставную базу. */
function breakTable(db: ReturnType<typeof fakeDb>, table: string) {
  const broken: unknown = new Proxy(() => undefined, {
    get: (_t, prop) =>
      prop === "then"
        ? (ok: (v: unknown) => unknown) =>
            ok({ data: null, count: null, error: { message: "boom" } })
        : () => broken,
  });
  return new Proxy(db, {
    get: (t, prop, r) =>
      prop === "from"
        ? (name: string) => (name === table ? broken : t.from(name))
        : Reflect.get(t, prop, r),
  });
}

const ctxOf = (db: unknown) =>
  ({ tenant: { id: BOT, modules: {} }, db }) as unknown as TenantContext;

describe("строгое чтение настроек", () => {
  it("сбой базы: мягкое чтение отдаёт «пусто», строгое — сбой", async () => {
    const db = fakeDb();
    db.tables.app_settings = [{ bot_id: BOT, key: "payment_mode", value: "deposit" }];
    const ctx = ctxOf(breakTable(db, "app_settings"));
    expect(await getSetting(ctx, "payment_mode")).toBeNull();
    expect(await getSettings(ctx, ["payment_mode"])).toEqual({});
    await expect(getSettingStrict(ctx, "payment_mode")).rejects.toThrow(/payment_mode/);
    await expect(getSettingsStrict(ctx, ["payment_mode"])).rejects.toThrow(/payment_mode/);
  });

  it("без сбоя оба варианта читают одно и то же", async () => {
    const db = fakeDb();
    db.tables.app_settings = [{ bot_id: BOT, key: "payment_mode", value: "deposit" }];
    const ctx = ctxOf(db);
    expect(await getSettingStrict(ctx, "payment_mode")).toBe("deposit");
    expect(await getSettingsStrict(ctx, ["payment_mode", "nope"])).toEqual({
      payment_mode: "deposit",
    });
    expect(await getSettingStrict(ctx, "nope")).toBeNull();
  });

  it("задаток: не прочитали режим оплаты — сумма к оплате не считается «полной»", async () => {
    const db = fakeDb();
    db.tables.app_settings = [
      { bot_id: BOT, key: "payment_mode", value: "deposit" },
      { bot_id: BOT, key: "deposit_percent", value: "30" },
    ];
    const order = { total: 10000, fulfillment_kind: "physical" };
    expect(await amountDueNow(ctxOf(db), order)).toBe(3000);
    await expect(amountDueNow(ctxOf(breakTable(db, "app_settings")), order)).rejects.toThrow();
    await expect(activeDeliveryZones(ctxOf(db))).resolves.toEqual([]);
  });
});

describe("авто-проверка чека", () => {
  it("не прочитали настройки — авто-проверки нет, чек уйдёт продавцу, покупатель не получает ошибку", async () => {
    const { receiptOcrAutoEnabled } = await import("@/core/receipts/verify.server");
    const db = fakeDb();
    const ctx = {
      tenant: { id: BOT, modules: { receipt_ocr: true } },
      db: breakTable(db, "app_settings"),
    } as unknown as TenantContext;
    expect(await receiptOcrAutoEnabled(ctx)).toBe(false);
    expect(reported).toHaveBeenCalledTimes(1);
  });
});
