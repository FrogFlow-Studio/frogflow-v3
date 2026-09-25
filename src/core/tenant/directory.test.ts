import { describe, expect, it } from "vitest";
import {
  servedByV2,
  findTenant,
  modulesFromJson,
  settingsFromJson,
  tenantFromRow,
  type TenantRow,
} from "./directory";

const row = (over: Partial<TenantRow>): TenantRow => ({
  id: "0bac1f86-5231-4e57-838d-2faa44d427e7",
  bot_name: "Educational Bot",
  status: "active",
  vertical: "digital",
  modules: { shop: true, vip: true, nonsense: true },
  settings: null,
  paused_message: null,
  owner_telegram_id: 1,
  app_url: "https://aatech-pi.vercel.app",
  archived_at: null,
  bot_token: null,
  ...over,
});

describe("tenant directory", () => {
  it("модули: только ключи реестра, остальные выключены", () => {
    const m = modulesFromJson({ shop: true, vip: "yes", robokassa: false, unknown: true });
    expect(m.shop).toBe(true);
    expect(m.vip).toBe(false);
    expect(m.robokassa).toBe(false);
    expect("unknown" in m).toBe(false);
    expect(modulesFromJson(null).shop).toBe(false);
  });

  it("настройки: мусор не ломает, строки нормализуются", () => {
    const s = settingsFromJson({
      slug: " Saltanat ",
      hosts: ["Shop.Example.KZ", 5, ""],
      zernio: { account_ids: ["acc1"] },
      served_by: "v2",
    });
    expect(s.slug).toBe("saltanat");
    expect(s.hosts).toEqual(["shop.example.kz"]);
    expect(s.zernio?.account_ids).toEqual(["acc1"]);
    expect(s.served_by).toBe("v2");
    expect(settingsFromJson("x")).toEqual({});
  });

  it("неизвестная ниша и статус читаются как digital/active", () => {
    const t = tenantFromRow(row({ vertical: "bakery", status: "weird" }));
    expect(t.vertical).toBe("digital");
    expect(t.status).toBe("active");
    expect(tenantFromRow(row({ status: "paused" })).status).toBe("paused");
  });

  it("находит по id, slug, host (свой домен и app_url) и аккаунту Zernio", () => {
    const a = tenantFromRow(row({}));
    const b = tenantFromRow(
      row({
        id: "de44b934-c8db-47ac-9aa9-535c762cf8c7",
        bot_name: "SALTANAT",
        app_url: "https://saltanatmaterial.vercel.app",
        settings: {
          slug: "saltanat",
          hosts: ["shop.saltanat.kz"],
          zernio: { account_ids: ["ZR1"] },
        },
      }),
    );
    const dir = [a, b];
    expect(findTenant(dir, { by: "id", value: b.id })?.name).toBe("SALTANAT");
    expect(findTenant(dir, { by: "slug", value: "SALTANAT" })?.id).toBe(b.id);
    expect(findTenant(dir, { by: "host", value: "shop.saltanat.kz:443" })?.id).toBe(b.id);
    expect(findTenant(dir, { by: "host", value: "aatech-pi.vercel.app" })?.id).toBe(a.id);
    expect(findTenant(dir, { by: "zernio_account", value: "zr1" })?.id).toBe(b.id);
    expect(findTenant(dir, { by: "host", value: "nobody.kz" })).toBeNull();
    expect(findTenant(dir, { by: "slug", value: "" })).toBeNull();
  });

  it("аккаунт Zernio, записанный у двух клиентов, — ничей: событие не уходит первому попавшемуся", () => {
    const a = tenantFromRow(row({ settings: { zernio: { account_ids: ["shared", "only-a"] } } }));
    const b = tenantFromRow(
      row({
        id: "de44b934-c8db-47ac-9aa9-535c762cf8c7",
        settings: { zernio: { account_ids: ["SHARED"] } },
      }),
    );
    expect(findTenant([a, b], { by: "zernio_account", value: "shared" })).toBeNull();
    expect(findTenant([a, b], { by: "zernio_account", value: "only-a" })?.id).toBe(a.id);
  });
});

describe("settings: default_locale", () => {
  it("принимает только известный язык", () => {
    expect(settingsFromJson({ default_locale: "kk" }).default_locale).toBe("kk");
    expect(settingsFromJson({ default_locale: "xx" }).default_locale).toBeUndefined();
  });
});

describe("servedByV2", () => {
  it("клиент виден v2 только по явному флагу оператора", () => {
    expect(servedByV2({ settings: { served_by: "v2" } })).toBe(true);
    expect(servedByV2({ settings: { served_by: "v1" } })).toBe(false);
    expect(servedByV2({ settings: {} })).toBe(false);
  });
});
