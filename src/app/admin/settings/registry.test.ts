import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../../tests/fake-db";
import { adminT, type AdminKey } from "@/app/i18n/admin";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";
import { recentSettingKeys } from "@/core/settings/settings";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { SETTING_KEYS } from "../setting-keys";
import {
  entryMatches,
  entryVisible,
  recentEntries,
  SETTINGS_REGISTRY,
  SETTINGS_THEMES,
} from "./registry";
import { visibleThemes } from "./nav";
import { searchSettings } from "./palette";

const page = readFileSync("src/routes/admin._authed.settings.tsx", "utf8");

describe("реестр настроек = страница настроек", () => {
  it("каждая карточка на странице есть в реестре, и каждая запись реестра без ссылки — на странице", () => {
    const onPage = [...page.matchAll(/<SettingsSection id="([^"]+)"/g)].map((m) => m[1]!);
    const cards = SETTINGS_REGISTRY.filter((e) => !e.to).map((e) => e.id);
    expect(new Set(onPage).size, "дубли <SettingsSection id>").toBe(onPage.length);
    expect(onPage.sort()).toEqual(cards.sort());
  });

  it("каждая настройка из SETTING_KEYS принадлежит какому-то разделу — новая без записи краснит тест", () => {
    const owned = new Set(SETTINGS_REGISTRY.flatMap((e) => e.keys ?? []));
    expect(SETTING_KEYS.filter((k) => !owned.has(k))).toEqual([]);
    // и обратное: в реестре нет несуществующих ключей
    expect([...owned].filter((k) => !(SETTING_KEYS as readonly string[]).includes(k))).toEqual([]);
  });

  it("id уникальны, у каждого раздела есть тема и подпись на 4 языках", () => {
    const ids = SETTINGS_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SETTINGS_REGISTRY) {
      expect(SETTINGS_THEMES, e.id).toContain(e.theme);
      for (const l of SUPPORTED_LOCALES)
        expect(adminT(l)(e.title, e.titleVars), `${l}:${e.id}`).not.toBe(e.title);
    }
    for (const l of SUPPORTED_LOCALES)
      for (const th of ["all", ...SETTINGS_THEMES])
        expect(adminT(l)(`settings19.theme.${th}` as AdminKey)).not.toBe(`settings19.theme.${th}`);
  });
});

describe("поиск и «изменено недавно»", () => {
  const t = adminT("ru");
  const text = (k: AdminKey, v?: Record<string, string>) => t(k, v);
  const find = (q: string) =>
    SETTINGS_REGISTRY.filter((e) => entryMatches(e, q, text)).map((e) => e.id);

  it("находит по названию раздела, названию поля и ключу; регистр не важен", () => {
    expect(find("робокасса")).toEqual([]);
    expect(find("Robokassa")).toContain("robokassa");
    expect(find("часовой пояс")).toContain("shop");
    expect(find("stripe_secret")).toEqual(["stripe"]);
    expect(find("команда")).toContain("team");
    expect(find("   ")).toHaveLength(SETTINGS_REGISTRY.length);
    expect(find("такого-нет-нигде")).toEqual([]);
  });

  it("раздел с отдельной страницы находится и ведёт на неё", () => {
    const e = SETTINGS_REGISTRY.find((x) => x.id === "consultant")!;
    expect(find("консультант")).toContain("consultant");
    expect(e.to).toBe("/admin/consultant");
  });

  it("видимость: модуль выключен или роль не владелец — раздела нет", () => {
    const stripe = SETTINGS_REGISTRY.find((e) => e.id === "stripe")!;
    expect(entryVisible(stripe, { role: "owner", modules: { stripe: true } })).toBe(true);
    expect(entryVisible(stripe, { role: "owner", modules: {} })).toBe(false);
    expect(entryVisible(stripe, { role: "manager", modules: { stripe: true } })).toBe(false);
  });

  it("консультант без продаж (BOVI): оплаты, доставки и заказа нет, его разделы и тариф на месте", () => {
    const all = Object.fromEntries(
      SETTINGS_REGISTRY.flatMap((e) => [e.module, ...(e.anyModule ?? [])]).map((m) => [m, true]),
    );
    const visible = (sells: boolean | undefined) =>
      SETTINGS_REGISTRY.filter((e) => entryVisible(e, { role: "owner", modules: all, sells })).map(
        (e) => e.id,
      );
    const bovi = visible(false);
    for (const gone of [
      "payment-methods",
      "commission",
      "fulfillment",
      "zones",
      "free-delivery",
      "min-order",
      "pay-remind",
      "marketplace",
      "watermark",
      "stripe",
      "prodamus",
      "robokassa",
      "crypto",
      "stars",
      "receipt-ocr",
      "smart-search",
      "low-stock",
      "gift-wrap",
      "referral",
    ])
      expect(bovi, gone).not.toContain(gone);
    for (const kept of [
      "shop",
      "telegram",
      "consultant",
      "billing",
      "ai-balance",
      "team",
      "invite",
      "takeout",
      "delete",
    ])
      expect(bovi, kept).toContain(kept);
    // Тема «Оплата и доставка» пустеет и пропадает из списка тем.
    expect(visibleThemes({ role: "owner", modules: all, sells: false })).not.toContain("payment");
    expect(visibleThemes({ role: "owner", modules: all, sells: false })).toContain("money");
    // Продаёт или не сказано — видно всё, как раньше.
    expect(visible(true)).toEqual(SETTINGS_REGISTRY.map((e) => e.id));
    expect(visible(undefined)).toEqual(SETTINGS_REGISTRY.map((e) => e.id));
    // Быстрый поиск тоже не находит скрытое.
    const t = adminT("ru");
    expect(
      searchSettings({ role: "owner", modules: all, sells: false }, "stripe_secret", t),
    ).toEqual([]);
    expect(searchSettings({ role: "owner", modules: all }, "stripe_secret", t)).toHaveLength(1);
  });

  it("недавно изменённый раздел — тот, у которого менялась хотя бы одна настройка", () => {
    expect([...recentEntries(["shop_name", "stripe_enabled"])].sort()).toEqual(["shop", "stripe"]);
    expect(recentEntries([]).size).toBe(0);
  });

  it("recentSettingKeys: только свежие и только известные, 1500 записей не обрезаются", async () => {
    const db = fakeDb({ maxRows: 1000 });
    const now = new Date("2026-10-04T10:00:00Z");
    db.tables.app_settings = [
      { bot_id: "b", key: "shop_name", value: "x", updated_at: "2026-10-03T10:00:00Z" },
      { bot_id: "b", key: "legal_offer", value: "x", updated_at: "2026-09-01T10:00:00Z" },
      { bot_id: "b", key: "internal_counter", value: "1", updated_at: "2026-10-04T09:00:00Z" },
      ...Array.from({ length: 1500 }, (_, i) => ({
        bot_id: "b",
        key: `noise_${String(i).padStart(4, "0")}`,
        value: "1",
        updated_at: "2026-10-04T09:00:00Z",
      })),
      { bot_id: "b", key: "weekly_report_enabled", value: "1", updated_at: "2026-10-04T09:30:00Z" },
    ];
    const ctx = { tenant: { id: "b" }, db } as unknown as TenantContext;
    expect((await recentSettingKeys(ctx, SETTING_KEYS, 7, now)).sort()).toEqual([
      "shop_name",
      "weekly_report_enabled",
    ]);
  });
});
