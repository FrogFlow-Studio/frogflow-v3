import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";

/**
 * Вход на витрину по коду из бота (В5): серверные функции без сервера.
 * createServerFn зовёт обработчик напрямую, cookie — в памяти, арендатор —
 * фейковый, база — в памяти. Подписи и проверки — настоящие.
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

type CookieOpts = Record<string, unknown>;
const jar = new Map<string, { value: string; opts: CookieOpts }>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (n: string) => jar.get(n)?.value,
  setCookie: (n: string, value: string, opts: CookieOpts) => jar.set(n, { value, opts }),
  deleteCookie: (n: string) => jar.delete(n),
}));
vi.mock("@/config/env", () => ({
  env: () => ({ SESSION_SECRET: "session-secret-session-secret-42", TELEGRAM_API_BASE: "" }),
}));
vi.mock("@/app/auth/login-guard.server", () => ({ clientIp: () => "1.2.3.4" }));

const TOKEN = "123456:shop-token";
const BOT = "11111111-1111-1111-1111-111111111111";
let ctx: TenantContext;
let token = TOKEN;
vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ctx.tenant,
  tenantContext: () => ctx,
}));

const { codeLoginFn, codeLoginStartFn } = await import("./code-login.functions");
const { webMyOrdersFn } = await import("./tg-login.functions");
const { issueLoginCode, LOGIN_MAX_TRIES } = await import("@/core/storefront/code-login");
const { loginNonceCookie } = await import("./code-login.server");
const { buyerCookieName } = await import("@/core/storefront/tg-login");

let db: FakeDb;
const SECRET = "session-secret-session-secret-42";

function shop(opts: { servedBy?: string; tgLogin?: boolean; direct?: boolean } = {}) {
  db = fakeDb({ unique: { app_settings: [["key"]], bot_users: [["user_key"]] } });
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "storefront_checkout",
      value: JSON.stringify({ enabled: true, tgLogin: opts.tgLogin ?? true }),
    },
  ];
  db.tables.bot_users = [
    {
      id: "u1",
      bot_id: BOT,
      user_key: "tg_42",
      platform: "telegram",
      telegram_id: 42,
      first_name: "Анна",
      state: {},
    },
    {
      id: "u2",
      bot_id: BOT,
      user_key: "wa_1",
      platform: "whatsapp",
      telegram_id: -77,
      first_name: "Мария",
      state: {},
    },
  ];
  db.tables.orders = [];
  ctx = {
    tenant: {
      id: BOT,
      status: "active",
      archived: false,
      telegramTokenEnc: "enc",
      modules: { shop: true, web_storefront: true },
      settings: {
        served_by: opts.servedBy ?? "v2",
        slug: "shop",
        default_locale: "ru",
        telegram: { username: "shop_bot" },
        zernio: opts.direct ? { accounts: [{ id: "a", platform: "whatsapp" }] } : undefined,
      },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
    secrets: { telegramToken: () => token },
  } as unknown as TenantContext;
}

const who = (key: string, id: number) => ({ userKey: key, telegramId: id }) as Customer;
/** Покупатель просит код у бота: то же, что делает /start lg_<метка>. */
async function codeFromBot(key = "tg_42", id = 42) {
  const nonce = jar.get(loginNonceCookie(BOT))!.value;
  const r = await issueLoginCode(ctx, SECRET, who(key, id), nonce);
  if (!r.ok) throw new Error(r.reason);
  return r.code;
}
const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

beforeEach(() => {
  jar.clear();
  token = TOKEN;
  shop();
});

describe("вход по коду на витрине", () => {
  it("ссылка в бот с меткой; метка в закрытой cookie; код из бота пускает покупателя", async () => {
    const start = await codeLoginStartFn({ data: { slug: "shop" } });
    const nonce = jar.get(loginNonceCookie(BOT))!.value;
    expect(start).toEqual({ botLink: `https://t.me/shop_bot?start=lg_${nonce}`, directText: null });
    expect(jar.get(loginNonceCookie(BOT))!.opts).toMatchObject({ httpOnly: true, secure: true });
    const code = await codeFromBot();
    expect(await codeLoginFn({ data: { slug: "shop", code } })).toEqual({ name: "Анна" });
    expect(jar.get(buyerCookieName(BOT))!.opts).toMatchObject({ httpOnly: true, secure: true });
    expect(jar.has(loginNonceCookie(BOT))).toBe(false);
  });

  it("у магазина подключён WhatsApp — сайт подсказывает сообщение «вход …»", async () => {
    shop({ direct: true });
    const start = await codeLoginStartFn({ data: { slug: "shop" } });
    const nonce = jar.get(loginNonceCookie(BOT))!.value;
    expect(start.directText).toBe(`вход ${nonce}`);
  });

  it("покупатель WhatsApp входит по коду: «Мои заказы» открываются по его id", async () => {
    await codeLoginStartFn({ data: { slug: "shop" } });
    const code = await codeFromBot("wa_1", -77);
    expect(await codeLoginFn({ data: { slug: "shop", code } })).toEqual({ name: "Мария" });
    expect(await webMyOrdersFn({ data: { slug: "shop" } })).not.toBeNull();
  });

  it("код можно ввести только один раз", async () => {
    await codeLoginStartFn({ data: { slug: "shop" } });
    const code = await codeFromBot();
    const nonce = jar.get(loginNonceCookie(BOT))!.value;
    await codeLoginFn({ data: { slug: "shop", code } });
    jar.set(loginNonceCookie(BOT), { value: nonce, opts: {} });
    await expect(codeLoginFn({ data: { slug: "shop", code } })).rejects.toThrow("уже использован");
  });

  it("неверный код — сколько попыток осталось; после лимита верный тоже не пускает", async () => {
    await codeLoginStartFn({ data: { slug: "shop" } });
    const code = await codeFromBot();
    await expect(codeLoginFn({ data: { slug: "shop", code: wrongFor(code) } })).rejects.toThrow(
      `Осталось попыток: ${LOGIN_MAX_TRIES - 1}`,
    );
    for (let i = 1; i < LOGIN_MAX_TRIES; i++)
      await expect(codeLoginFn({ data: { slug: "shop", code: wrongFor(code) } })).rejects.toThrow();
    await expect(codeLoginFn({ data: { slug: "shop", code } })).rejects.toThrow("Слишком много");
    expect(jar.has(buyerCookieName(BOT))).toBe(false);
  });

  it("без метки в браузере (кода не просили) — вход не состоялся", async () => {
    await expect(codeLoginFn({ data: { slug: "shop", code: "123456" } })).rejects.toThrow(
      "Сначала нажмите",
    );
    expect(jar.has(buyerCookieName(BOT))).toBe(false);
  });

  it("код, выданный на чужую метку, в этом браузере не подходит", async () => {
    await codeLoginStartFn({ data: { slug: "shop" } });
    const code = await codeFromBot();
    jar.set(loginNonceCookie(BOT), { value: "AAAAAAAAAAAAAAAAAAAAAA", opts: {} });
    await expect(codeLoginFn({ data: { slug: "shop", code } })).rejects.toThrow("Код не подошёл");
    expect(jar.has(buyerCookieName(BOT))).toBe(false);
  });

  it("клиент прежней платформы и выключенный вход: страницы нет, метка не выдаётся", async () => {
    shop({ servedBy: "v1" });
    await expect(codeLoginStartFn({ data: { slug: "shop" } })).rejects.toThrow();
    await expect(codeLoginFn({ data: { slug: "shop", code: "123456" } })).rejects.toThrow();
    shop({ tgLogin: false });
    await expect(codeLoginStartFn({ data: { slug: "shop" } })).rejects.toThrow();
    expect(jar.size).toBe(0);
  });

  it("почта ничего не открывает: заказ с чужой почтой не даёт входа", async () => {
    await codeLoginStartFn({ data: { slug: "shop" } });
    // в базе есть покупатель с почтой, но кода из бота у браузера нет
    db.tables.bot_users![0]!.email = "anna@example.com";
    await expect(codeLoginFn({ data: { slug: "shop", code: "123456" } })).rejects.toThrow();
    expect(jar.has(buyerCookieName(BOT))).toBe(false);
  });
});
