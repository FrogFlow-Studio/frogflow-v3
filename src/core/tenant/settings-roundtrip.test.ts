import { describe, expect, it } from "vitest";
import { watermarkEnabled } from "@/core/delivery/watermark.server";
import type { TenantContext } from "./resolve.server";
import { settingsFromJson } from "./directory";
import type { TenantSettings } from "./types";

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
  review_ask_days: 5,
  gift_sale: { enabled: true, amounts: [5000, 10000], currency: "KZT" },
  admin: {
    username: "owner",
    password_hash: "scrypt$a$b",
    users: [{ username: "kate", password_hash: "scrypt$c$d", role: "accountant" }],
    invites: [
      {
        id: "i1",
        hash: "abc",
        role: "manager",
        created_at: "2026-10-04T10:00:00.000Z",
        expires_at: "2026-10-11T10:00:00.000Z",
        by: "owner",
      },
    ],
  },
  // площадка (core/marketplace)
  marketplace: { listed: true, approved: true, category: "Торты", city: "Алматы" },
  // оформление витрины (core/storefront/design)
  storefront_about: {
    description: "Печём торты",
    phone: "+7 700 000 00 00",
    address: "Алматы, Абая 1",
    hours: "Пн–Сб 10:00–19:00",
    delivery: "По городу",
    payment: "Kaspi",
  },
  storefront_design: { theme: "warm", cover: true, blocks: ["hits", "new"] },
  // сообщество авторов (core/community)
  community: {
    enabled: true,
    name: "Анна",
    niche: "Торты",
    city: "Алматы",
    about: "Печём на заказ",
    links: ["https://example.com"],
    dm_off: true,
    dm_blocked: ["b41a34cb-7944-441b-8f71-503184fc0f1f"],
  },
  community_recommend: ["b41a34cb-7944-441b-8f71-503184fc0f1f"],
  community_mod: { status: "hidden", reason: "спам", at: "2026-10-04T10:00:00.000Z" },
  // оператор
  slug: "shop",
  hosts: ["shop.kz"],
  served_by: "v2",
  served_by_since: "2026-10-01T09:00:00.000Z",
  notify_read: { "admin:kate": "2026-10-02T09:00:00.000Z" },
  on_overdue: "suspend",
  warn_days_before: 3,
  grace_days: 2,
  multi_bot: { group: "g1" },
  consultant_limits: { daily_usd: 2, daily_calls: null, daily_tests: 5 },
  smart_search_limits: { daily_usd: 1 },
  billing: { plan: "flowers.pro", addons: ["whatsapp"], period: "year" },
  // комиссия платформы (core/commission)
  commission: {
    start: "2027-02-01",
    billed: { "2027-02": "inv-1" },
    amounts: { "2027-02": 1200 },
    topup: { "2027-02": { invoice: "inv-2", prev: 1000 } },
  },
  // приглашение автора автором (core/invites)
  invite: {
    by: "b41a34cb-7944-441b-8f71-503184fc0f1f",
    at: "2026-10-04T10:00:00.000Z",
    reward: { at: "2026-10-05T10:00:00.000Z", by: "operator", payment_id: "pay-1" },
  },
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

  it("приглашение автора: кто пригласил и выданный зачёт переживают чтение; мусор отбрасывается", () => {
    expect(s.invite).toEqual(SAVED.invite);
    expect(settingsFromJson({ invite: { by: "не-id" } }).invite).toBeUndefined();
    expect(
      settingsFromJson({ invite: { by: SAVED.invite.by, reward: { at: "нет" } } }).invite,
    ).toEqual({ by: SAVED.invite.by, at: "" });
  });

  it("начало комиссии: только дата ГГГГ-ММ-ДД; мусор отбрасывается", () => {
    expect(s.commission).toEqual(SAVED.commission);
    for (const bad of ["1 января", "2027-13-45", 20270101, null])
      expect(settingsFromJson({ commission: { start: bad } }).commission).toBeUndefined();
  });

  it("месяцы комиссии в счетах: только ГГГГ-ММ с номером счёта", () => {
    const c = settingsFromJson({
      commission: { billed: { "2027-03": "inv-3", март: "x", "2027-04": 5, "2027-05": "" } },
    }).commission;
    expect(c).toEqual({ start: undefined, billed: { "2027-03": "inv-3" } });
  });

  it("выставленная комиссия и доплата: суммы без мусора", () => {
    const c = settingsFromJson({
      commission: {
        amounts: { "2027-03": 500, март: 1, "2027-04": "5", "2027-05": -1 },
        topup: {
          "2027-03": { invoice: "inv-3", prev: 400 },
          "2027-04": { invoice: "", prev: 1 },
          "2027-05": { invoice: "x", prev: "1" },
        },
      },
    }).commission;
    expect(c).toEqual({
      start: undefined,
      amounts: { "2027-03": 500 },
      topup: { "2027-03": { invoice: "inv-3", prev: 400 } },
    });
  });

  it("срок просьбы об оценке: только целое 1–30", () => {
    expect(settingsFromJson({ review_ask_days: 7 }).review_ask_days).toBe(7);
    for (const bad of [0, 31, 2.5, "5", null])
      expect(settingsFromJson({ review_ask_days: bad }).review_ask_days).toBeUndefined();
  });

  it("остальные ключи админки и оператора на месте", () => {
    expect(s).toMatchObject({
      timezone: "Asia/Almaty",
      consultant_pause_hours: 3,
      review_ask_days: 5,
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

/**
 * Образец на КАЖДЫЙ верхний ключ TenantSettings. `satisfies Record<keyof …>`:
 * добавили ключ в тип — typecheck требует строку здесь, а тест ниже требует,
 * чтобы settingsFromJson его не потерял (ключ без разбора молча исчезал бы
 * при чтении, как было с guard, community и community_mod).
 */
const UUID = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const AT = "2026-10-04T10:00:00.000Z";
const ALL = {
  slug: "shop",
  hosts: ["shop.kz"],
  default_locale: "kk",
  review_ask_days: 5,
  timezone: "Asia/Almaty",
  telegram: { username: "shop_bot", webhook_ok: true, commands_v: "v3" },
  zernio: {
    profile_id: "p1",
    account_ids: ["a1"],
    accounts: [{ id: "a1", platform: "instagram", username: "shop", name: "Shop", expired: false }],
    synced_at: AT,
    ice_breakers_v: "ib1",
    guard: { instagram: { since: AT, reason: "failures", fails: 4, last_fail_at: AT } },
    wizard: { whatsapp: { step: "test", at: AT, started_at: AT } },
  },
  multi_bot: { group: "g1" },
  vip: { token_enc: "enc:v1:x", username: "vip_bot", webhook_ok: true },
  admin: {
    username: "owner",
    password_hash: "scrypt$a$b",
    users: [{ username: "kate", password_hash: "scrypt$c$d", role: "manager" }],
  },
  curators: { mode: "cohort", items: [{ id: UUID, name: "Анна", telegram_id: 111 }] },
  homework_replies: [{ title: "Молодец", text: "Отличная работа, {name}!" }],
  served_by: "v2",
  served_by_since: AT,
  deletion: { requested_at: AT, by: "owner", prev_status: "active" },
  notify_read: { "admin:kate": AT },
  partner: "agency-1",
  invite: { by: UUID, at: AT },
  signup: { source: "site:google/spring", page: "cakes" },
  consultant_limits: { daily_usd: 2, daily_calls: null, daily_tests: 5 },
  consultant_pause_hours: 3,
  consultant_search: true,
  consultant_pricelist: { enabled: true, hours: { open: 9, close: 18 }, rate_source: "vtb" },
  bot_texts: { welcome: { telegram: { ru: "Привет!" } } },
  work_hours: { open: 9, close: 18 },
  smart_search_limits: { daily_usd: 1 },
  on_overdue: "suspend",
  warn_days_before: 3,
  grace_days: 2,
  billing: { plan: "flowers.pro", period: "year" },
  commission: { start: "2027-01-01" },
  gift_sale: { enabled: true, amounts: [5000], currency: "KZT" },
  community: {
    enabled: true,
    name: "Лавка",
    niche: "Торты",
    city: "Алматы",
    about: "Печём",
    links: ["https://shop.kz"],
    dm_off: true,
    dm_blocked: [UUID],
  },
  community_mod: { status: "hidden", reason: "жалоба", at: AT },
  community_recommend: [UUID],
  storefront_about: { description: "x" },
  storefront_design: { theme: "warm", cover: true, blocks: ["hits", "new"] },
  marketplace: { listed: true, hidden: false, approved: true, category: "Торты", city: "Алматы" },
  collections: [{ id: "a1b2c3d4", name: "Весна", product_ids: [UUID], created_at: AT }],
  delivery: { pdf_watermark: true },
} satisfies Record<keyof TenantSettings, unknown>;

describe("каждый верхний ключ TenantSettings переживает чтение", () => {
  const out = settingsFromJson(ALL);
  for (const key of Object.keys(ALL))
    it(`${key}: после settingsFromJson не потерян`, () => {
      expect(out[key as keyof TenantSettings], key).not.toBeUndefined();
    });

  it("вложенные подключи, которые раньше терялись, на месте", () => {
    expect(out.zernio?.guard?.instagram).toMatchObject({ reason: "failures", fails: 4 });
    expect(out.zernio?.wizard?.whatsapp).toMatchObject({ step: "test" });
    expect(out.zernio?.ice_breakers_v).toBe("ib1");
    expect(out.telegram?.commands_v).toBe("v3");
    expect(out.community).toMatchObject({
      enabled: true,
      name: "Лавка",
      links: ["https://shop.kz"],
      dm_off: true,
      dm_blocked: [UUID],
    });
    expect(out.community_mod).toEqual({ status: "hidden", reason: "жалоба", at: AT });
    expect(out.community_recommend).toEqual([UUID]);
    expect(out.marketplace).toMatchObject({ listed: true, approved: true, category: "Торты" });
  });
});

describe("команда магазина переживает чтение целиком", () => {
  it("имя, дата, роль и приглашения: что записал updateAdminSettings, то и читается", () => {
    const out = settingsFromJson({
      admin: {
        username: "owner",
        password_hash: "scrypt$a$b",
        users: [
          {
            username: "Kate",
            password_hash: "scrypt$c$d",
            role: "manager",
            name: "Катя",
            created_at: AT,
          },
          { username: "bob", password_hash: "scrypt$e$f", role: "что-то новое" },
          { username: "", password_hash: "scrypt$g$h", role: "manager" },
        ],
        invites: [
          { id: "i1", hash: "abc", role: "viewer", created_at: AT, expires_at: AT, by: "owner" },
        ],
      },
    });
    expect(out.admin?.users).toEqual([
      {
        username: "kate",
        password_hash: "scrypt$c$d",
        role: "manager",
        name: "Катя",
        created_at: AT,
      },
      {
        username: "bob",
        password_hash: "scrypt$e$f",
        role: "viewer",
        name: undefined,
        created_at: undefined,
      },
    ]);
    expect(out.admin?.invites).toHaveLength(1);
  });
});
