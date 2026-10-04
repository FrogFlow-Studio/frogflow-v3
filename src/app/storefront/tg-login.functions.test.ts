import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { signInitData } from "@/core/storefront/init-data";
import { buyerCookieName, signLoginWidget } from "@/core/storefront/tg-login";

/**
 * Вход покупателя на витрину через Telegram: серверные функции без сервера.
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

const {
  tgLoginFn,
  tgLoginStateFn,
  tgLogoutFn,
  webMyOrdersFn,
  linkWebOrderFn,
  webOrderLinkStateFn,
  webFavoritesSyncFn,
} = await import("./tg-login.functions");
const { orderAccessToken } = await import("@/core/storefront/web-order");

let db: FakeDb;
const COOKIE = buyerCookieName(BOT);

function shop(opts: { servedBy?: string; tgLogin?: boolean } = {}) {
  db = fakeDb({ unique: { app_settings: [["key"]], bot_users: [["user_key"]] } });
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "storefront_checkout",
      value: JSON.stringify({ enabled: true, tgLogin: opts.tgLogin ?? true }),
    },
  ];
  db.tables.bot_users = [];
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
      },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
    secrets: { telegramToken: () => token },
  } as unknown as TenantContext;
}

const now = () => String(Math.floor(Date.now() / 1000));
function widget(id: number, t = TOKEN) {
  const fields = { id: String(id), first_name: "Анна", auth_date: now() };
  return { ...fields, hash: signLoginWidget(fields, t) };
}

beforeEach(() => {
  jar.clear();
  token = TOKEN;
  shop();
});

describe("вход через Telegram на витрине", () => {
  it("кнопка есть, покупатель входит подписью бота магазина, cookie закрыта от скриптов", async () => {
    expect(await tgLoginStateFn({ data: { slug: "shop" } })).toEqual({
      available: true,
      bot: "shop_bot",
      me: null,
      points: false,
    });
    expect(await tgLoginFn({ data: { slug: "shop", widget: widget(42) } })).toEqual({
      name: "Анна",
    });
    expect(jar.get(COOKIE)!.opts).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    expect(db.tables.bot_users!.map((u) => u.user_key)).toEqual(["tg_42"]);
    expect((await tgLoginStateFn({ data: { slug: "shop" } })).me).toEqual({ name: "Анна" });
  });

  it("у магазина есть баллы — состояние входа говорит об этом (подсказка «войдите ради баллов»)", async () => {
    (ctx.tenant.modules as Record<string, boolean>).loyalty = true;
    expect(await tgLoginStateFn({ data: { slug: "shop" } })).toMatchObject({
      available: true,
      me: null,
      points: true,
    });
  });

  it("подпись бота другого магазина — вход не состоялся, cookie нет", async () => {
    await expect(
      tgLoginFn({ data: { slug: "shop", widget: widget(42, "999:other") } }),
    ).rejects.toThrow("Не удалось войти через Telegram");
    expect(jar.size).toBe(0);
    expect(db.tables.bot_users).toEqual([]);
  });

  it("внутри Telegram — вход по initData Mini App той же проверкой", async () => {
    const initData = signInitData(
      { auth_date: now(), user: JSON.stringify({ id: 7, first_name: "Ира" }) },
      TOKEN,
    );
    expect(await tgLoginFn({ data: { slug: "shop", initData } })).toEqual({ name: "Ира" });
    expect(jar.has(COOKIE)).toBe(true);
    const forged = signInitData({ auth_date: now(), user: JSON.stringify({ id: 8 }) }, "999:other");
    jar.clear();
    await expect(tgLoginFn({ data: { slug: "shop", initData: forged } })).rejects.toThrow();
    expect(jar.size).toBe(0);
  });

  it("клиент прежней платформы: входа нет вовсе", async () => {
    shop({ servedBy: "v1" });
    expect((await tgLoginStateFn({ data: { slug: "shop" } })).available).toBe(false);
    await expect(tgLoginFn({ data: { slug: "shop", widget: widget(42) } })).rejects.toBeTruthy();
    expect(jar.size).toBe(0);
    expect(await webMyOrdersFn({ data: { slug: "shop" } })).toBeNull();
  });

  it("продавец выключил вход — кнопки нет, прежние входы не действуют", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    const cookie = jar.get(COOKIE)!;
    shop({ tgLogin: false });
    jar.set(COOKIE, cookie);
    expect(await tgLoginStateFn({ data: { slug: "shop" } })).toMatchObject({ available: false });
    expect(await webMyOrdersFn({ data: { slug: "shop" } })).toBeNull();
  });

  it("продавец сменил токен бота — прежние входы не действуют", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    token = "123456:new-token";
    expect((await tgLoginStateFn({ data: { slug: "shop" } })).me).toBeNull();
    expect(await webMyOrdersFn({ data: { slug: "shop" } })).toBeNull();
  });

  it("выход удаляет cookie", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    await tgLogoutFn({ data: { slug: "shop" } });
    expect(jar.has(COOKIE)).toBe(false);
  });
});

describe("«Мои заказы» на сайте после входа", () => {
  const order = (id: number, telegram_id: number, platform: string) => ({
    id,
    bot_id: BOT,
    order_no: id,
    display_no: id,
    telegram_id,
    user_key: `tg_${telegram_id}`,
    platform,
    status: "awaiting_payment",
    total: 1000,
    currency: "KZT",
    fulfillment_kind: "digital",
    created_at: new Date(Date.UTC(2026, 8, 1) + id * 60_000).toISOString(),
    order_items: [],
  });

  it("не вошёл — null, без запросов к заказам", async () => {
    db.tables.orders = [order(1, 42, "telegram")];
    expect(await webMyOrdersFn({ data: { slug: "shop" } })).toBeNull();
  });

  it("только заказы этого покупателя: и из бота, и с сайта; ссылок на страницу заказа нет", async () => {
    db.tables.orders = [order(1, 42, "telegram"), order(2, 42, "web"), order(3, 43, "web")];
    db.tables.order_items = [];
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    const r = await webMyOrdersFn({ data: { slug: "shop" } });
    expect(r!.orders.map((o) => o.id).sort()).toEqual([1, 2]);
    expect(JSON.stringify(r)).not.toMatch(/"t":|token/);
  });

  it("подделанная cookie чужого покупателя не открывает его заказы", async () => {
    db.tables.orders = [order(3, 43, "web")];
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    const [, exp, mac] = jar.get(COOKIE)!.value.split(".");
    jar.set(COOKIE, { value: `43.${exp}.${mac}`, opts: {} });
    expect(await webMyOrdersFn({ data: { slug: "shop" } })).toBeNull();
  });
});

describe("старые заказы с сайта: привязка к Telegram по ссылке заказа", () => {
  const WEB_TG = -999;
  const orderToken = (id: number) => orderAccessToken("session-secret-session-secret-42", BOT, id);
  function withWebOrder() {
    db.tables.bot_users!.push({
      id: "web-1",
      user_key: "web_abc",
      platform: "web",
      telegram_id: WEB_TG,
      email: "anna@example.kz",
      state: {},
    });
    db.tables.orders = [
      {
        id: 5,
        bot_id: BOT,
        order_no: 5,
        display_no: 5,
        telegram_id: WEB_TG,
        user_key: "web_abc",
        platform: "web",
        status: "delivered",
        total: 1000,
        currency: "KZT",
        fulfillment_kind: "digital",
        customer_email: "anna@example.kz",
        created_at: "2026-09-01T10:00:00Z",
        order_items: [],
      },
    ];
    db.tables.order_items = [];
  }
  const myOrderIds = async () =>
    ((await webMyOrdersFn({ data: { slug: "shop" } }))?.orders ?? []).map((o) => o.id);
  const tgRow = (id: number) => db.tables.bot_users!.find((u) => u.user_key === `tg_${id}`)!;
  // Лимит входов с одного адреса общий на файл: каждый тест — в новом окне.
  let clock = Date.now();
  beforeEach(() => {
    clock += 60 * 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
  });
  afterEach(() => vi.useRealTimers());

  it("совпадение почты само по себе ничего не связывает", async () => {
    withWebOrder();
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    tgRow(42).email = "anna@example.kz";
    expect(await myOrderIds()).toEqual([]);
  });

  it("без подписанной ссылки или без входа — не привязать", async () => {
    withWebOrder();
    await expect(
      linkWebOrderFn({ data: { slug: "shop", id: 5, t: orderToken(5) } }),
    ).rejects.toBeTruthy();
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    await expect(
      linkWebOrderFn({ data: { slug: "shop", id: 5, t: "0".repeat(32) } }),
    ).rejects.toBeTruthy();
    await expect(
      linkWebOrderFn({ data: { slug: "shop", id: 5, t: orderToken(6) } }),
    ).rejects.toBeTruthy();
    expect(await myOrderIds()).toEqual([]);
    expect(tgRow(42).state).not.toHaveProperty("web_orders");
  });

  it("по ссылке заказа и нажатию — заказ в «Моих заказах», строка заказа не меняется", async () => {
    withWebOrder();
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    const ref = { slug: "shop", id: 5, t: orderToken(5) };
    expect(await webOrderLinkStateFn({ data: ref })).toEqual({ state: "linkable" });
    expect(await linkWebOrderFn({ data: ref })).toEqual({ ok: true });
    expect(await webOrderLinkStateFn({ data: ref })).toEqual({ state: "linked" });
    expect(await myOrderIds()).toEqual([5]);
    expect(db.tables.orders![0]!.telegram_id).toBe(WEB_TG);
    expect(db.tables.orders![0]!.user_key).toBe("web_abc");
    expect(tgRow(42).state).toMatchObject({ web_orders: [5] });
    const web = db.tables.bot_users!.find((u) => u.user_key === "web_abc")!;
    expect(web.state).toEqual({ telegram_links: { "5": 42 }, telegram_links_v: 1 });
    // Повторное нажатие ничего не дублирует.
    expect(await linkWebOrderFn({ data: ref })).toEqual({ ok: true });
    expect(tgRow(42).state).toMatchObject({ web_orders: [5] });
  });

  it("заказ, привязанный к одному Telegram, другому не достаётся", async () => {
    withWebOrder();
    const ref = { slug: "shop", id: 5, t: orderToken(5) };
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    await linkWebOrderFn({ data: ref });
    await tgLoginFn({ data: { slug: "shop", widget: widget(43) } });
    await expect(linkWebOrderFn({ data: ref })).rejects.toThrow(/другому Telegram/);
    expect(await myOrderIds()).toEqual([]);
  });

  it("клиент прежней платформы — привязки нет", async () => {
    shop({ servedBy: "v1" });
    withWebOrder();
    await expect(
      linkWebOrderFn({ data: { slug: "shop", id: 5, t: orderToken(5) } }),
    ).rejects.toBeTruthy();
    expect(await webOrderLinkStateFn({ data: { slug: "shop", id: 5, t: orderToken(5) } })).toEqual({
      state: null,
    });
  });
});

describe("избранное вошедшего покупателя", () => {
  const f = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const sync = (ids: string[], mode: "merge" | "replace") =>
    webFavoritesSyncFn({ data: { slug: "shop", ids, mode } });
  const saved = () =>
    (db.tables.bot_users![0]!.state as { web_fav?: { ids: string[]; rev: number } }).web_fav;

  it("не вошёл — null, в магазине ничего не пишется", async () => {
    expect(await sync([f(1)], "merge")).toBeNull();
    expect(db.tables.bot_users).toEqual([]);
  });

  it("при входе браузерное и сохранённое складываются, ничего не теряется", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    expect(await sync([f(1), f(2)], "merge")).toEqual([f(1), f(2)]);
    // другой телефон: свои отметки, в магазине уже есть чужие
    expect(await sync([f(3), f(1)], "merge")).toEqual([f(3), f(1), f(2)]);
    expect(saved()?.ids).toEqual([f(3), f(1), f(2)]);
  });

  it("снятое сердечко не возвращается: «заменить» берёт список из браузера", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    await sync([f(1), f(2)], "merge");
    expect(await sync([f(2)], "replace")).toEqual([f(2)]);
    expect(saved()?.ids).toEqual([f(2)]);
  });

  it("повтор без изменений не поднимает rev, остальное состояние не затирается", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    db.tables.bot_users![0]!.state = {
      ...(db.tables.bot_users![0]!.state as object),
      mode: "idle",
      loyalty_note: "x",
    };
    await sync([f(1)], "merge");
    const rev = saved()?.rev;
    await sync([f(1)], "merge");
    expect(saved()?.rev).toBe(rev);
    expect(db.tables.bot_users![0]!.state).toMatchObject({ mode: "idle", loyalty_note: "x" });
  });

  it("чужое не видно: избранное привязано к покупателю", async () => {
    await tgLoginFn({ data: { slug: "shop", widget: widget(42) } });
    await sync([f(1)], "merge");
    jar.clear();
    await tgLoginFn({ data: { slug: "shop", widget: widget(43) } });
    expect(await sync([f(9)], "merge")).toEqual([f(9)]);
  });

  it("клиент прежней платформы — null", async () => {
    shop({ servedBy: "v1" });
    expect(await sync([f(1)], "merge")).toBeNull();
  });
});
