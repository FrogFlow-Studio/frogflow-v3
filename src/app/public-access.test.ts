import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { fakeDb, type FakeDb } from "../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";

/**
 * Что общее у всех публичных серверных функций (docs/SECURITY-PUBLIC.md): закрытая, чужая и
 * несуществующая витрина отвечают одинаково; неверная, чужая и подделанная подпись заказа не
 * отличается от несуществующего заказа; перебор ограничен. createServerFn зовёт обработчик
 * напрямую, подменены только тенант, окружение и чтение данных — проверки доступа настоящие.
 */
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse: (d: unknown) => unknown = (d) => d;
    const b = {
      validator(v: (d: unknown) => unknown) {
        parse = v;
        return b;
      },
      handler(h: (a: { data: unknown }) => unknown) {
        return (a: { data: unknown }) => h({ data: parse(a.data) });
      },
    };
    return b;
  },
}));
const SECRET = "s".repeat(32);
vi.mock("@/config/env", () => ({
  env: () => ({ SESSION_SECRET: SECRET, SECRETS_KEY: "k".repeat(32), YANDEX_VERIFICATION: "yx" }),
}));

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
const certificateByCode = vi.fn(async (_ctx: unknown, _code: string) => null);
vi.mock("@/core/courses/certificate.server", () => ({
  certificateByCode: (ctx: unknown, code: string) => certificateByCode(ctx, code),
  certificateRevoked: async () => false,
}));

const BOT = "11111111-1111-1111-1111-111111111111";
const OTHER_BOT = "22222222-2222-2222-2222-222222222222";
let db: FakeDb;

const tenant = (id: string, over: Record<string, unknown> = {}): Tenant =>
  ({
    id,
    name: "Магазин",
    archived: false,
    vertical: "shop",
    modules: { shop: true, web_storefront: true, telegram_mini_app: true, legal_docs: true },
    settings: { slug: "open", served_by: "v2" },
    ...over,
  }) as unknown as Tenant;

const TENANTS: Record<string, Tenant | null> = {
  open: tenant(BOT),
  ghost: null,
  v1shop: tenant(OTHER_BOT, { settings: { slug: "v1shop", served_by: "v1" } }),
  archived: tenant(OTHER_BOT, { archived: true }),
  nomodule: tenant(OTHER_BOT, { modules: {} }),
  cart: tenant("44444444-4444-4444-4444-444444444444", {
    settings: { slug: "cart", served_by: "v2", telegram: { username: "cart_bot" } },
  }),
  course: tenant("33333333-3333-3333-3333-333333333333", {
    modules: { shop: true, courses: true },
    settings: { slug: "course", served_by: "v2" },
  }),
};
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async (l: { value: string }) => TENANTS[l.value] ?? null,
  tenantContext: (t: Tenant): TenantContext =>
    ({ tenant: t, db, timezone: "Asia/Almaty", appUrl: "https://x.test" }) as never,
}));
vi.mock("@/core/storefront/web-order", async (orig) => ({
  ...(await orig<typeof import("@/core/storefront/web-order")>()),
  webCheckoutSettings: async () => ({ enabled: true, tgLogin: true }),
  webOrderView: vi.fn(async (_ctx: unknown, id: number) => ({ id, status: "pending" })),
  webCardPaymentUrl: async () => "https://pay.test/x",
}));
vi.mock("@/app/storefront/tg-login.server", () => ({
  tgLoginAvailable: async () => true,
  buyerTelegramId: async () => 77,
}));
vi.mock("@/core/storefront/web-link", () => ({
  webOrderLinkState: async () => "can_link",
  linkWebOrder: async () => "linked",
}));

const checkout = await import("@/app/storefront/checkout.functions");
const tgLogin = await import("@/app/storefront/tg-login.functions");
const { orderAccessToken, webOrderView } = await import("@/core/storefront/web-order");
const { isNotFound } = await import("@tanstack/react-router");

const outcome = async (run: () => unknown): Promise<string> => {
  try {
    return `ok:${JSON.stringify(await run())}`;
  } catch (e) {
    return isNotFound(e) ? "notFound" : `error:${(e as Error).message}`;
  }
};

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  vi.useRealTimers();
  vi.mocked(webOrderView).mockClear();
});

describe("страница заказа по ссылке", () => {
  const good = orderAccessToken(SECRET, BOT, 5);
  const call = (fn: "order" | "reorder" | "card" | "link", over: Record<string, unknown> = {}) => {
    const data = { slug: "open", id: 5, t: good, ...over };
    const f = {
      order: checkout.webOrderFn,
      reorder: checkout.webOrderReorderFn,
      card: checkout.webCardPayFn,
      link: tgLogin.webOrderLinkStateFn,
    }[fn];
    return outcome(() => f({ data } as never));
  };

  it("верная подпись открывает заказ, неверная, чужая и подделанная — один и тот же 404", async () => {
    expect(await call("order")).toBe('ok:{"id":5,"status":"pending"}');
    const wrong = [
      "0".repeat(32), // верная форма, неверное значение
      orderAccessToken(SECRET, BOT, 6), // подпись другого заказа
      orderAccessToken(SECRET, OTHER_BOT, 5), // подпись другого магазина
      createHmac("sha256", "другой секрет").update("x").digest("hex").slice(0, 32),
      good.slice(0, 31), // короче
      `${good}0`, // длиннее
      good.toUpperCase(), // другой регистр
      "",
    ];
    for (const t of wrong) expect(await call("order", { t }), t).toBe("notFound");
    // Несуществующий и закрытый магазин отвечают так же.
    for (const slug of ["ghost", "v1shop", "archived", "nomodule"])
      expect(await call("order", { slug }), slug).toBe("notFound");
    expect(webOrderView).toHaveBeenCalledTimes(1);
  });

  it("то же у повтора заказа, ссылки на оплату и привязки к Telegram", async () => {
    for (const fn of ["reorder", "card", "link"] as const) {
      expect(await call(fn, { t: "0".repeat(32) }), fn).toBe("notFound");
      expect(await call(fn, { t: orderAccessToken(SECRET, BOT, 6) }), fn).toBe("notFound");
      expect(await call(fn, { slug: "ghost" }), fn).toBe(
        fn === "link" ? 'ok:{"state":null}' : "notFound",
      );
    }
  });

  it("неверные подписи не тратят счётчик заказа: перебор не запирает настоящего покупателя", async () => {
    for (let i = 0; i < 100; i++) await call("order", { t: "0".repeat(32) });
    expect(await call("order")).toBe('ok:{"id":5,"status":"pending"}');
  });

  it("перебор по верной подписи ограничен: после 30 запросов в минуту — отказ без данных заказа", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:00:10Z"));
    const results: string[] = [];
    const id = 77; // свой заказ: счётчики других проверок этого файла не мешают
    const own = orderAccessToken(SECRET, BOT, id);
    for (let i = 0; i < 31; i++) results.push(await call("order", { id, t: own }));
    expect(results.slice(0, 30).every((r) => r.startsWith("ok:"))).toBe(true);
    expect(results[30]).toMatch(/^error:/);
    expect(results[30]).not.toContain("pending");
    // Другой заказ того же магазина считается отдельно.
    const other = orderAccessToken(SECRET, BOT, 9);
    expect(await call("order", { id: 9, t: other })).toMatch(/^ok:/);
  });

  it("в ответе нет почты, телефона и адреса покупателя: вид собирается из полей без контактов", async () => {
    const out = await call("order");
    for (const k of ["email", "phone", "address", "telegram"]) expect(out).not.toContain(k);
  });
});

describe("закрытая витрина отвечает как несуществующая", () => {
  const fns: Array<[string, () => Promise<{ handler: unknown }>, Record<string, unknown>]> = [];
  const add = async (path: string, name: string, extra: Record<string, unknown> = {}) => {
    const mod = (await import(path)) as Record<string, (a: { data: unknown }) => unknown>;
    fns.push([name, mod[name] as never, extra]);
  };
  const UUID = "b41a34cb-7944-441b-8f71-503184fc0f1f";

  it("клиент прежней платформы, архивный, без модуля и неизвестный — один исход", async () => {
    await add("./storefront/storefront.functions", "storeInfoFn");
    await add("./storefront/storefront.functions", "storeCatalogFn");
    await add("./storefront/storefront.functions", "storeProductFn", { id: UUID });
    await add("./storefront/storefront.functions", "legalFn", { doc: "offer" });
    await add("./storefront/about.functions", "storeAboutPageFn");
    await add("./storefront/showcase.functions", "storeShowcaseFn");
    await add("./storefront/catalog.functions", "storeCatalogPageFn");
    await add("./storefront/catalog.functions", "storeFavoritesFn", { ids: [UUID] });
    await add("./storefront/catalog.functions", "storeCollectionFn", { id: "abcdef" });
    await add("./storefront/partner-promos.functions", "partnerPromosFn");
    await add("./storefront/gift.functions", "giftSaleInfoFn");
    await add("./storefront/checkout.functions", "webCheckoutInfoFn");
    await add("./storefront/reviews.functions", "storeReviewsFn", { id: UUID });
    await add("./storefront/quiz.functions", "storeQuizFn");
    await add("./storefront/tg-login.functions", "tgLoginStateFn");
    expect(fns.length).toBeGreaterThanOrEqual(15);
    // Контроль: у открытого магазина те же функции отвечают иначе, иначе проверка пуста.
    let differs = 0;
    for (const [name, fn, extra] of fns) {
      const ask = (slug: string) =>
        outcome(() =>
          (fn as unknown as (a: { data: unknown }) => unknown)({ data: { slug, ...extra } }),
        );
      const ghost = await ask("ghost");
      for (const slug of ["v1shop", "archived", "nomodule"])
        expect(await ask(slug), `${name}: ${slug}`).toBe(ghost);
      if ((await ask("open")) !== ghost) differs++;
    }
    expect(differs).toBeGreaterThanOrEqual(10);
  });
});

describe("сертификат по коду", () => {
  const CODE = "ABCDEFGHJKMN";
  const ask = async (slug: string, code = CODE) => {
    const { certificateViewFn } = await import("@/app/storefront/certificate.functions");
    return outcome(() => certificateViewFn({ data: { slug, code } } as never));
  };

  it("неверный код, чужой и закрытый магазин — один и тот же 404", async () => {
    // Магазин без модуля «Курсы», клиент прежней платформы, архив и неизвестный — как несуществующий код.
    for (const slug of ["ghost", "v1shop", "archived", "nomodule", "open"])
      expect(await ask(slug), slug).toBe("notFound");
    expect(await ask("course", "слишком-короткий-код")).toBe("notFound");
    expect(await ask("course")).toBe("notFound");
    expect(certificateByCode).toHaveBeenCalledTimes(1);
  });

  it("перебор ограничен: после лимита код даже не ищется", async () => {
    certificateByCode.mockClear();
    for (let i = 0; i < 40; i++) await ask("course", "ABCDEFGHJKMP");
    expect(certificateByCode.mock.calls.length).toBeLessThanOrEqual(30);
    expect(certificateByCode.mock.calls.length).toBeGreaterThan(0);
    // Другой код считается отдельно.
    const before = certificateByCode.mock.calls.length;
    await ask("course", "ABCDEFGHJKMQ");
    expect(certificateByCode.mock.calls.length).toBe(before + 1);
  });
});

describe("отчёт партнёра по подписи", () => {
  it("неверная подпись, подпись чужого кода и подпись чужим секретом не проходят", async () => {
    const { verifyPartnerToken, partnerToken } = await import("@/core/partners/partners");
    const good = partnerToken(SECRET, "agency");
    expect(verifyPartnerToken(SECRET, "agency", good)).toBe(true);
    for (const t of [
      partnerToken(SECRET, "other"),
      "0".repeat(32),
      "",
      good.slice(1),
      partnerToken("x".repeat(32), "agency"),
    ])
      expect(verifyPartnerToken(SECRET, "agency", t), t).toBe(false);
  });

  it("неверная подпись и неизвестный код при верной подписи отвечают одним текстом", async () => {
    const { partnerReportFn } = await import("@/app/partner/partner.functions");
    const { partnerToken } = await import("@/core/partners/partners");
    const ask = (code: string, t: string) =>
      outcome(() => partnerReportFn({ data: { code, t } } as never));
    const wrongSignature = await ask("agency", "0".repeat(32));
    const unknownCode = await ask("nobody", partnerToken(SECRET, "nobody"));
    expect(wrongSignature).toContain("Ссылка недействительна");
    expect(unknownCode).toBe(wrongSignature);
  });
});

describe("публичные страницы без данных клиентов", () => {
  it("код подтверждения сайта — единственное, что отдаёт функция", async () => {
    const { siteVerificationFn } = await import("@/app/landing/verification.functions");
    expect(await siteVerificationFn({ data: undefined } as never)).toEqual({ yandex: "yx" });
  });
});

describe("замок входа", () => {
  const stamp = () => {
    for (const t of ["admin_login_attempts", "operator_login_attempts"])
      for (const r of db.tables[t] ?? []) r.at ??= new Date().toISOString();
  };

  it("пять неудач с одного адреса запирают вход, другой адрес и другой магазин не затронуты", async () => {
    const { loginLocked, recordLogin } = await import("@/app/auth/login-guard.server");
    for (let i = 0; i < 4; i++) await recordLogin({ botId: BOT }, "1.1.1.1", false, "u");
    stamp();
    expect(await loginLocked({ botId: BOT }, "1.1.1.1")).toBe(false);
    await recordLogin({ botId: BOT }, "1.1.1.1", false, "u");
    stamp();
    expect(await loginLocked({ botId: BOT }, "1.1.1.1")).toBe(true);
    expect(await loginLocked({ botId: BOT }, "2.2.2.2")).toBe(false);
    expect(await loginLocked({ botId: OTHER_BOT }, "1.1.1.1")).toBe(false);
    expect(await loginLocked("operator", "1.1.1.1")).toBe(false);
  });

  it("вход оператора считается отдельно, запросы без адреса — одним общим счётом", async () => {
    const { loginLocked, recordLogin } = await import("@/app/auth/login-guard.server");
    for (let i = 0; i < 5; i++) await recordLogin("operator", null, false, "op");
    stamp();
    expect(await loginLocked("operator", null)).toBe(true);
    expect(await loginLocked("operator", "3.3.3.3")).toBe(false);
    expect(await loginLocked({ botId: BOT }, null)).toBe(false);
  });

  it("удачный вход не копит неудач", async () => {
    const { loginLocked, recordLogin } = await import("@/app/auth/login-guard.server");
    for (let i = 0; i < 9; i++) await recordLogin({ botId: BOT }, "4.4.4.4", true, "u");
    stamp();
    expect(await loginLocked({ botId: BOT }, "4.4.4.4")).toBe(false);
  });
});

describe("ссылка «корзина → бот»", () => {
  it("анонимный вызов ограничен: каждая ссылка — строка в базе", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T12:00:10Z"));
    const { createHandoffFn } = await import("@/app/storefront/storefront.functions");
    const item = { product_id: "b41a34cb-7944-441b-8f71-503184fc0f1f", quantity: 1 };
    const ask = (slug: string) =>
      outcome(() => createHandoffFn({ data: { slug, items: [item] } } as never));
    const results: string[] = [];
    for (let i = 0; i < 21; i++) results.push(await ask("cart"));
    expect(results.slice(0, 20).every((r) => r.startsWith("ok:"))).toBe(true);
    expect(results[20]).toMatch(/^error:/);
    expect(db.tables.web_cart_handoffs).toHaveLength(20);
    // Закрытый и неизвестный магазин — 404 и без записи.
    for (const slug of ["ghost", "v1shop", "archived", "nomodule"])
      expect(await ask(slug), slug).toBe("notFound");
    expect(db.tables.web_cart_handoffs).toHaveLength(20);
  });
});
