import { describe, expect, it } from "vitest";
import { availableModules } from "@/core/modules/registry";
import {
  addressConflict,
  telegramBotTaken,
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
    expect(settingsFromJson({ timezone: "Europe/Moscow" }).timezone).toBe("Europe/Moscow");
    expect(settingsFromJson({ timezone: "Mars/Olympus" }).timezone).toBeUndefined();
  });

  it("план клиента — из settings.billing.plan, а не из колонки subscription_plan", () => {
    expect(tenantFromRow(row({})).plan).toBeNull();
    const t = tenantFromRow(
      row({ settings: { billing: { plan: "flowers.pro", period: "year" } } }),
    );
    expect(t.plan).toBe("flowers.pro");
    expect(t.settings.billing?.plan).toBe("flowers.pro");
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

  it("slug или домен, записанный у двух клиентов, — ничей: витрину не перехватить", () => {
    const a = tenantFromRow(row({ settings: { slug: "shop", hosts: ["a.kz"] } }));
    const b = tenantFromRow(
      row({
        id: "de44b934-c8db-47ac-9aa9-535c762cf8c7",
        settings: { slug: "shop", hosts: ["a.kz"] },
      }),
    );
    expect(findTenant([a, b], { by: "slug", value: "shop" })).toBeNull();
    expect(findTenant([b, a], { by: "slug", value: "shop" })).toBeNull();
    expect(findTenant([a, b], { by: "host", value: "a.kz" })).toBeNull();
    expect(findTenant([a], { by: "slug", value: "shop" })?.id).toBe(a.id);
  });

  it("telegramBotTaken: бот другого магазина занят, свой — нет", () => {
    const a = tenantFromRow(row({ settings: { telegram: { username: "ShopBot" } } }));
    expect(telegramBotTaken([a], "other-id", "shopbot")).toBe(a.name);
    expect(telegramBotTaken([a], a.id, "ShopBot")).toBeNull();
    expect(telegramBotTaken([a], "other-id", "another_bot")).toBeNull();
    expect(telegramBotTaken([a], "other-id", undefined)).toBeNull();
  });

  it("addressConflict: занятый slug или домен другого клиента, свой — не конфликт", () => {
    const a = tenantFromRow(row({ settings: { slug: "anna", hosts: ["a.kz"] } }));
    expect(addressConflict([a], null, { slug: "ANNA" })).toEqual({ what: "anna", owner: a.name });
    expect(addressConflict([a], null, { hosts: ["A.kz"] })?.what).toBe("a.kz");
    expect(addressConflict([a], a.id, { slug: "anna", hosts: ["a.kz"] })).toBeNull();
    expect(addressConflict([a], null, { slug: "other", hosts: ["b.kz"] })).toBeNull();
    expect(addressConflict([a], null, { slug: null })).toBeNull();
  });

  it("addressConflict: служебный адрес занят платформой, но у кого он уже стоит — остаётся", () => {
    const a = tenantFromRow(row({ settings: { slug: "shop" } }));
    expect(addressConflict([], null, { slug: "Admin" })).toEqual({
      what: "admin",
      owner: "FrogFlow",
    });
    expect(addressConflict([a], "other-id", { slug: "frogflow-shop" })?.owner).toBe("FrogFlow");
    expect(addressConflict([a], a.id, { slug: "shop" })).toBeNull();
    expect(addressConflict([a], a.id, { slug: "api" })?.owner).toBe("FrogFlow");
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

  it("двум аккаунтам без точного id не угадывает: неизвестный аккаунт — ничей", () => {
    const a = tenantFromRow(row({ settings: { zernio: { account_ids: ["acc_1"] } } }));
    const b = tenantFromRow(
      row({
        id: "de44b934-c8db-47ac-9aa9-535c762cf8c7",
        settings: { zernio: { account_ids: ["acc_2"] } },
      }),
    );
    expect(findTenant([a, b], { by: "zernio_account", value: "unknown" })).toBeNull();
    expect(findTenant([a], { by: "zernio_account", value: "unknown" })).toBeNull();
  });
});

describe("settings: свои пределы ИИ клиента", () => {
  it("свой предел консультанта доходит до ядра, мусор отбрасывается", () => {
    expect(
      settingsFromJson({
        consultant_limits: { daily_usd: 40, daily_calls: null, daily_tests: "x" },
      }).consultant_limits,
    ).toEqual({ daily_usd: 40, daily_calls: null, daily_tests: null });
    expect(settingsFromJson({ consultant_limits: null }).consultant_limits).toBeUndefined();
    expect(settingsFromJson({}).consultant_limits).toBeUndefined();
  });

  it("свой предел умного поиска в долларах доходит до ядра", () => {
    expect(
      settingsFromJson({ smart_search_limits: { daily_usd: 10 } }).smart_search_limits,
    ).toEqual({ daily_usd: 10 });
    expect(
      settingsFromJson({ smart_search_limits: { daily_usd: "10" } }).smart_search_limits,
    ).toEqual({ daily_usd: null });
    expect(settingsFromJson({}).smart_search_limits).toBeUndefined();
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

describe("ниша клиента из bots.vertical", () => {
  it("пустая ниша или её отсутствие — digital: живые клиенты v1 разницы не заметят", () => {
    expect(tenantFromRow(row({ vertical: null as unknown as string })).vertical).toBe("digital");
    expect(tenantFromRow(row({ vertical: "" })).vertical).toBe("digital");
  });

  it("известная ниша сохраняется, консультант тоже", () => {
    expect(tenantFromRow(row({ vertical: "confectionery" })).vertical).toBe("confectionery");
    expect(tenantFromRow(row({ vertical: "flowers" })).vertical).toBe("flowers");
    expect(tenantFromRow(row({ vertical: "consultant" })).vertical).toBe("consultant");
  });
});

describe("модули клиента v2 на плане — по плану, а не по сохранённым флагам", () => {
  const tenant = (settings: Record<string, unknown>, modules: Record<string, boolean>) =>
    tenantFromRow({
      id: "b",
      bot_name: "Магазин",
      status: "active",
      vertical: "digital",
      modules,
      settings,
      paused_message: null,
      owner_telegram_id: null,
      app_url: null,
      archived_at: null,
      bot_token: null,
    } as unknown as TenantRow);

  it("модуль, ставший готовым после записи плана (курсы), открывается сам на Pro", () => {
    // Флаги записаны, когда курсы были «в разработке»: courses=false.
    const saved = { shop: true, courses: false };
    const pro = tenant({ served_by: "v2", billing: { plan: "digital.pro" } }, saved);
    expect(pro.modules.courses).toBe(true);
    expect(pro.modules.shop).toBe(true);
    const basic = tenant({ served_by: "v2", billing: { plan: "digital.basic" } }, saved);
    expect(basic.modules.courses).toBe(false);
  });

  it("сохранённые оператором модули сверх плана остаются", () => {
    const t = tenant(
      { served_by: "v2", billing: { plan: "digital.basic", grandfathered: ["courses"] } },
      { shop: true },
    );
    expect(t.modules.courses).toBe(true);
  });

  it("включённое в базе вне плана не выключается молча (как у «Демо-тестера» на Pro)", () => {
    const t = tenant(
      { served_by: "v2", billing: { plan: "digital.pro" } },
      { shop: true, instagram: true, wa_shop: true, referral: true, crypto: true },
    );
    expect(t.modules.instagram).toBe(true);
    expect(t.modules.wa_shop).toBe(true);
    expect(t.modules.referral).toBe(true);
    // «В разработке» не открывается и так: его снимает контекст клиента.
    expect(availableModules(t.modules).crypto).toBe(false);
  });

  it("клиент v1, индивидуальные условия и без плана — флаги как в базе", () => {
    const flags = { shop: true, courses: false, crypto: true };
    expect(tenant({ billing: { plan: "digital.pro" } }, flags).modules.courses).toBe(false);
    expect(tenant({ served_by: "v2", billing: { plan: "custom" } }, flags).modules.crypto).toBe(
      true,
    );
    expect(tenant({ served_by: "v2" }, flags).modules.courses).toBe(false);
  });
});
