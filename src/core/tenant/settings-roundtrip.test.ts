import { describe, expect, it } from "vitest";
import { watermarkEnabled } from "@/core/delivery/watermark.server";
import type { TenantContext } from "./resolve.server";
import { settingsFromJson } from "./directory";

/**
 * Всё, что панели сохраняют в `bots.settings` через patchTenantSettings,
 * должно пережить чтение клиента: иначе переключатель в админке «сохранён»,
 * а ядро его не видит (так было с водяным знаком PDF).
 */
const SAVED = {
  // админка продавца
  timezone: "Asia/Almaty",
  delivery: { pdf_watermark: true },
  consultant_pause_hours: 3,
  gift_sale: { enabled: true, amounts: [5000, 10000], currency: "KZT" },
  admin: {
    username: "owner",
    password_hash: "scrypt$a$b",
    users: [{ username: "kate", password_hash: "scrypt$c$d", role: "accountant" }],
  },
  // оператор
  slug: "shop",
  hosts: ["shop.kz"],
  served_by: "v2",
  served_by_since: "2026-10-01T09:00:00.000Z",
  on_overdue: "suspend",
  warn_days_before: 3,
  grace_days: 2,
  multi_bot: { group: "g1" },
  consultant_limits: { daily_usd: 2, daily_calls: null, daily_tests: 5 },
  smart_search_limits: { daily_usd: 1 },
  billing: { plan: "flowers.pro", addons: ["whatsapp"], period: "year" },
  // регистрация: откуда пришёл клиент (core/signup/origin)
  signup: { source: "site:google/spring", page: "cakes" },
  // каналы
  telegram: { username: "shop_bot", webhook_ok: true },
  vip: { token_enc: "enc:v1:x", username: "vip_bot", webhook_ok: true },
  zernio: { profile_id: "p1", account_ids: ["a1"] },
};

describe("settingsFromJson не теряет сохранённые ключи", () => {
  const s = settingsFromJson(SAVED);

  it("водяной знак из админки доходит до выдачи PDF", () => {
    expect(s.delivery).toEqual({ pdf_watermark: true });
    const ctx = { tenant: { settings: s } } as unknown as TenantContext;
    expect(watermarkEnabled(ctx)).toBe(true);
    const off = settingsFromJson({ delivery: { pdf_watermark: false } });
    expect(watermarkEnabled({ tenant: { settings: off } } as unknown as TenantContext)).toBe(false);
    expect(settingsFromJson({ delivery: { pdf_watermark: "yes" } }).delivery).toEqual({
      pdf_watermark: false,
    });
  });

  it("остальные ключи админки и оператора на месте", () => {
    expect(s).toMatchObject({
      timezone: "Asia/Almaty",
      consultant_pause_hours: 3,
      gift_sale: { enabled: true, amounts: [5000, 10000], currency: "KZT" },
      admin: {
        username: "owner",
        password_hash: "scrypt$a$b",
        users: [{ username: "kate", password_hash: "scrypt$c$d", role: "accountant" }],
      },
      slug: "shop",
      hosts: ["shop.kz"],
      served_by: "v2",
      served_by_since: "2026-10-01T09:00:00.000Z",
      on_overdue: "suspend",
      warn_days_before: 3,
      grace_days: 2,
      multi_bot: { group: "g1" },
      consultant_limits: { daily_usd: 2, daily_calls: null, daily_tests: 5 },
      smart_search_limits: { daily_usd: 1 },
      billing: { plan: "flowers.pro", addons: ["whatsapp"], period: "year" },
      signup: { source: "site:google/spring", page: "cakes" },
      telegram: { username: "shop_bot", webhook_ok: true },
      vip: { token_enc: "enc:v1:x", username: "vip_bot", webhook_ok: true },
      zernio: { profile_id: "p1", account_ids: ["a1"] },
    });
  });

  it("каждый ключ TenantSettings, записанный в settings, читается обратно", () => {
    for (const key of Object.keys(SAVED)) expect(s, key).toHaveProperty(key);
  });
});
