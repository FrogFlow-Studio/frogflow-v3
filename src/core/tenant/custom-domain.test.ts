import { describe, expect, it } from "vitest";
import { tenantFromRow, type TenantRow } from "./directory";
import {
  cleanHosts,
  customDomainRoute,
  customHostProblem,
  isPlatformHost,
  normalizeHost,
  shopForHost,
  storefrontBase,
} from "./custom-domain";

const APP = "https://www.frogflow.tech";

const row = (over: Partial<TenantRow>): TenantRow => ({
  id: "0bac1f86-5231-4e57-838d-2faa44d427e7",
  bot_name: "Цветы",
  status: "active",
  vertical: "flowers",
  modules: { shop: true, web_storefront: true },
  settings: { slug: "flowers", hosts: ["shop.flowers.kz"], served_by: "v2" },
  paused_message: null,
  owner_telegram_id: 1,
  app_url: null,
  archived_at: null,
  bot_token: null,
  ...over,
});
const flowers = tenantFromRow(row({}));
const cakes = tenantFromRow(
  row({
    id: "1bac1f86-5231-4e57-838d-2faa44d427e7",
    bot_name: "Торты",
    settings: { slug: "cakes", hosts: ["cakes.kz", "www.cakes.kz"], served_by: "v2" },
  }),
);

describe("свой домен: имя хоста", () => {
  it("нормализуется: регистр, порт, точка в конце; мусор — null", () => {
    expect(normalizeHost(" Shop.Flowers.KZ:443 ")).toBe("shop.flowers.kz");
    expect(normalizeHost("cakes.kz.")).toBe("cakes.kz");
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("bad host")).toBeNull();
    expect(normalizeHost("https://cakes.kz")).toBeNull();
  });

  it("общий адрес платформы и служебные хосты — не домен магазина", () => {
    for (const h of [
      "www.frogflow.tech",
      "frogflow.tech",
      "app.frogflow.tech",
      "frogflowplatform.vercel.app",
      "anything-preview.vercel.app",
      "localhost",
      "127.0.0.1",
      "[::1]",
    ])
      expect(isPlatformHost(h, APP), h).toBe(true);
    expect(isPlatformHost("shop.flowers.kz", APP)).toBe(false);
    expect(isPlatformHost("frogflow.tech.evil.kz", APP)).toBe(false);
  });

  it("оператор не может записать магазину адрес платформы или кривое имя", () => {
    expect(customHostProblem("shop.flowers.kz", APP)).toBeNull();
    expect(customHostProblem("www.frogflow.tech", APP)).toMatch(/платформ/);
    expect(customHostProblem("promo.frogflow.tech", APP)).toMatch(/платформ/);
    expect(customHostProblem("x.vercel.app", APP)).toMatch(/платформ/);
    expect(customHostProblem("1.2.3.4", APP)).toMatch(/платформ|домен/);
    expect(customHostProblem("localhost", APP)).toMatch(/платформ|домен/);
    expect(customHostProblem("no-dot", APP)).toMatch(/домен/);
    expect(customHostProblem("https://cakes.kz", APP)).toMatch(/домен/);
  });
});

describe("свой домен: какой магазин", () => {
  const dir = [flowers, cakes];

  it("домен магазина — этот магазин, общий адрес — никакой", () => {
    expect(shopForHost(dir, "shop.flowers.kz:443", APP)?.id).toBe(flowers.id);
    expect(shopForHost(dir, "WWW.CAKES.KZ", APP)?.id).toBe(cakes.id);
    expect(shopForHost(dir, "www.frogflow.tech", APP)).toBeNull();
    expect(shopForHost(dir, "unknown.kz", APP)).toBeNull();
  });

  it("захват: общий адрес платформы у магазина не срабатывает", () => {
    const thief = tenantFromRow(
      row({
        id: "2bac1f86-5231-4e57-838d-2faa44d427e7",
        settings: { slug: "thief", hosts: ["www.frogflow.tech"], served_by: "v2" },
        app_url: APP,
      }),
    );
    expect(shopForHost([thief, flowers], "www.frogflow.tech", APP)).toBeNull();
  });

  it("домен у двух магазинов — ничей; клиент v1 и архив — не открываются", () => {
    const twin = tenantFromRow(
      row({ id: "3bac1f86-5231-4e57-838d-2faa44d427e7", settings: flowers.settings }),
    );
    expect(shopForHost([flowers, twin], "shop.flowers.kz", APP)).toBeNull();
    const v1 = tenantFromRow(row({ settings: { ...flowers.settings, served_by: "v1" } }));
    expect(shopForHost([v1], "shop.flowers.kz", APP)).toBeNull();
    const archived = tenantFromRow(row({ archived_at: "2026-09-01T00:00:00Z" }));
    expect(shopForHost([archived], "shop.flowers.kz", APP)).toBeNull();
  });

  it("без короткого адреса витрину не собрать — домен не работает", () => {
    const noSlug = tenantFromRow(
      row({ settings: { hosts: ["shop.flowers.kz"], served_by: "v2" } }),
    );
    expect(shopForHost([noSlug], "shop.flowers.kz", APP)).toBeNull();
  });
});

describe("свой домен: что открывается", () => {
  it("корень — витрина магазина, с сохранением параметров", () => {
    expect(customDomainRoute(flowers, "/", "", APP)).toEqual({
      redirect: "/s/flowers",
    });
    expect(customDomainRoute(flowers, "/", "?lang=kk", APP)).toEqual({
      redirect: "/s/flowers?lang=kk",
    });
  });

  it("своя витрина, товары, корзина, файлы и серверные функции — открываются", () => {
    for (const p of [
      "/s/flowers",
      "/s/flowers/p/123",
      "/s/flowers/cart",
      "/_serverFn/abc",
      "/assets/app.js",
      "/api/img/x.jpg",
      "/favicon.ico",
    ])
      expect(customDomainRoute(flowers, p, "", APP), p).toEqual({ pass: true });
  });

  it("чужая витрина на домене магазина — не найдена", () => {
    expect(customDomainRoute(flowers, "/s/cakes", "", APP)).toEqual({ notFound: true });
    expect(customDomainRoute(flowers, "/s/cakes/p/1", "", APP)).toEqual({ notFound: true });
    // Кривое %-кодирование — «не найден», а не ошибка сервера.
    expect(customDomainRoute(flowers, "/s/%E0%A4%A", "", APP)).toEqual({ notFound: true });
    expect(customDomainRoute(flowers, "/s/%66lowers", "", APP)).toEqual({ pass: true });
  });

  it("админка, оператор и регистрация — только на общем адресе", () => {
    expect(customDomainRoute(flowers, "/admin/login", "", APP)).toEqual({
      redirect: "https://www.frogflow.tech/admin/login",
    });
    expect(customDomainRoute(flowers, "/operator", "?x=1", APP)).toEqual({
      redirect: "https://www.frogflow.tech/operator?x=1",
    });
    expect(customDomainRoute(flowers, "/signup", "", APP)).toEqual({
      redirect: "https://www.frogflow.tech/signup",
    });
    // Похожие пути — не админка.
    expect(customDomainRoute(flowers, "/administrator", "", APP)).toEqual({ pass: true });
  });
});

describe("свой домен: ссылки на витрину и Mini App", () => {
  it("есть домен — https://<домен>/s/<slug>, нет — общий адрес", () => {
    expect(storefrontBase(flowers, APP)).toBe("https://shop.flowers.kz/s/flowers");
    expect(storefrontBase(cakes, APP)).toBe("https://cakes.kz/s/cakes");
    const plain = tenantFromRow(row({ settings: { slug: "plain", served_by: "v2" } }));
    expect(storefrontBase(plain, APP)).toBe("https://www.frogflow.tech/s/plain");
    const noSlug = tenantFromRow(row({ settings: { served_by: "v2" } }));
    expect(storefrontBase(noSlug, APP)).toBe(`https://www.frogflow.tech/s/${noSlug.id}`);
  });
});

describe("свой домен: запись оператором", () => {
  it("нормализует и убирает повторы; адрес платформы — отказ с текстом", () => {
    expect(cleanHosts([" Shop.Flowers.KZ ", "shop.flowers.kz.", ""], APP)).toEqual({
      hosts: ["shop.flowers.kz"],
    });
    expect(cleanHosts(["cakes.kz", "www.frogflow.tech"], APP)).toEqual({
      error: expect.stringMatching(/платформ/),
    });
  });
});
