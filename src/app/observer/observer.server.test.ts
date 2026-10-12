import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import {
  OBSERVER_DEFAULT_ON,
  OBSERVER_STATE_KEY,
  observerLogKey,
  parseEnabled,
  observerInPlan,
  parseFindings,
  sellerSignalText,
  sellerSignal,
  contactLinks,
  SIGNAL_MAX_CHARS,
} from "@/core/observer/observer";
import { SUPPORTED_LOCALES } from "@/core/i18n/locale";

const KOPILKA = OBSERVER_DEFAULT_ON[0]!;
const NOW = Date.parse("2026-10-10T06:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

let db: FakeDb;
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (tenant: unknown) => ({
    tenant,
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  }),
}));
vi.mock("@/lib/preview", () => ({ previewReadonly: () => false }));

const { runDialogObserver } = await import("./observer.server");

const tenant = (id = KOPILKA, plan = "digital.business") =>
  ({
    id,
    name: "Копилка",
    plan,
    archived: false,
    settings: { served_by: "v2" },
    modules: {},
  }) as never;
const budget = { left: () => 90_000 };

let seq = 0;
const say = (tid: number, sender: "customer" | "bot" | "manager", min: number, text: string) =>
  db.tables.manager_chat_messages!.push({
    id: `m${String(++seq).padStart(4, "0")}`,
    bot_id: KOPILKA,
    telegram_id: tid,
    direction: sender === "customer" ? "in" : "out",
    sender,
    text,
    created_at: ago(min),
  });

const setting = (key: string) =>
  db.tables.app_settings!.find((r) => r.key === key)?.value as string | undefined;

type Call = { system: string; user: string };
function deps(answer: (c: Call) => unknown, now = NOW) {
  const calls: Call[] = [];
  const seller: string[] = [];
  const operator: string[] = [];
  return {
    calls,
    seller,
    operator,
    d: {
      now: () => now,
      callModel: async (system: string, user: string) => {
        calls.push({ system, user });
        return {
          input: answer({ system, user }),
          usage: { input_tokens: 2000, output_tokens: 200 },
        };
      },
      notifySeller: async (_ctx: unknown, html: string) => {
        seller.push(html);
        return 1;
      },
      alertOperator: async (html: string) => {
        operator.push(html);
        return { ok: true };
      },
    },
  };
}

const flag = (tid: number, kind = "other_country", audience = "seller") => ({
  findings: [
    {
      dialog_id: String(tid),
      kind,
      audience,
      quote: "Как оплатить из Беларуси?",
      summary: "Покупатель из Беларуси, Kaspi у него нет.",
      reply: "Здравствуйте! Пришлю реквизиты для оплаты из Беларуси.",
    },
  ],
});

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.manager_chat_messages = [];
  db.tables.orders = [];
  db.tables.bot_users = [];
  seq = 0;
});

describe("наблюдатель: кто включён", () => {
  it("Копилка — по умолчанию да, остальные — нет; ключ решает поверх", () => {
    expect(parseEnabled(null, KOPILKA)).toBe(true);
    expect(parseEnabled(null, "other")).toBe(false);
    expect(parseEnabled("false", KOPILKA)).toBe(false);
    expect(parseEnabled("true", "other")).toBe(true);
  });

  it("выключенный клиент — ни чтения диалогов, ни модели", async () => {
    say(1, "customer", 5, "Здравствуйте");
    const x = deps(() => ({ findings: [] }));
    expect(await runDialogObserver(tenant("other"), budget, x.d)).toEqual({ skipped: "off" });
    expect(x.calls).toHaveLength(0);
  });

  it("наблюдатель только в Business и по договору: на Pro модель не зовём", async () => {
    say(1, "customer", 5, "Здравствуйте");
    const x = deps(() => ({ findings: [] }));
    expect(await runDialogObserver(tenant(KOPILKA, "digital.pro"), budget, x.d)).toEqual({
      skipped: "plan",
    });
    expect(x.calls).toHaveLength(0);
    expect(observerInPlan("custom")).toBe(true);
    expect(observerInPlan("digital.business")).toBe(true);
    expect(observerInPlan(null)).toBe(false);
  });
});

describe("наблюдатель: прогон", () => {
  it("покупатель из Беларуси — продавцу подсказка с цитатой, ответом и ссылкой; покупателю ничего", async () => {
    say(77, "customer", 40, "Палитра");
    say(77, "bot", 40, "Палитра — 1700 ₸. Нажмите «Купить».");
    say(77, "customer", 6, "Как оплатить из Беларуси?");
    say(77, "bot", 6, "🌍 Выберите страну оплаты: 1. Казахстан");
    const x = deps(() => flag(77));
    const r = await runDialogObserver(tenant(), budget, x.d);
    expect(r).toMatchObject({ dialogs: 1, findings: 1, sent: 1 });
    expect(x.calls).toHaveLength(1);
    // Свежие строки помечены, старая история — для контекста.
    expect(x.calls[0]!.user).toContain("* [");
    expect(x.calls[0]!.user).toContain("Как оплатить из Беларуси?");
    expect(x.seller).toHaveLength(1);
    // Цитата — среди последних реплик, второй раз отдельно не повторяется.
    expect(x.seller[0]).toContain("Последние сообщения");
    expect(x.seller[0]).toContain("Как оплатить из Беларуси?");
    expect(x.seller[0]).toContain("Пришлю реквизиты");
    expect(x.seller[0]).toContain("https://app.test/admin/chat?c=77");
    expect(x.operator).toHaveLength(0);
    // Журнал находок и отметка «писали» — в настройках клиента.
    const log = JSON.parse(setting(observerLogKey("2026-10-10"))!);
    expect(log).toMatchObject([{ tid: 77, kind: "other_country", sent: "seller" }]);
    const state = JSON.parse(setting(OBSERVER_STATE_KEY)!);
    expect(state.signals["77"]).toBe(new Date(NOW).toISOString());
    expect(state.spend.usd).toBeCloseTo(0.006);
    // Покупателю — ни одной новой реплики.
    expect(db.tables.manager_chat_messages).toHaveLength(4);
  });

  it("подсказка по Instagram: профиль и Direct кнопками, заказ с товаром, три последние реплики", async () => {
    db.tables.bot_users!.push({
      user_key: "ig:1838791457529399",
      bot_id: KOPILKA,
      telegram_id: 131,
      platform: "instagram",
      username: "sofronovaaaaaa",
      first_name: "KATERINA",
      state: {},
    });
    db.tables.orders!.push({
      id: 4241,
      bot_id: KOPILKA,
      telegram_id: 131,
      order_no: 131,
      display_no: 131,
      status: "awaiting_payment",
      total: 1700,
      currency: "KZT",
      created_at: new Date(NOW - 26 * 3600_000).toISOString(),
      order_items: [{ name_snapshot: "Палитра средств выразительности" }],
    });
    say(131, "bot", 60, "🧾 Заказ #131 оформлен. Выберите способ оплаты.");
    say(131, "customer", 7, "💳 Картой РФ");
    say(131, "customer", 7, "Здравствуйте Не получается оплатить");
    say(131, "bot", 7, "Откройте ссылку и оплатите картой российского банка.");
    const buttons: unknown[] = [];
    const x = deps(() => ({
      findings: [
        {
          dialog_id: "131",
          kind: "card_trouble",
          audience: "seller",
          quote: "Здравствуйте Не получается оплатить",
          summary: "Второй раз не может оплатить картой РФ.",
          reply: "Уточните, что происходит при оплате.",
        },
      ],
    }));
    const notify = x.d.notifySeller;
    x.d.notifySeller = async (c: unknown, html: string, b?: unknown) => {
      buttons.push(b);
      return notify(c, html);
    };
    await runDialogObserver(tenant(), budget, x.d);
    const t = x.seller[0]!;
    expect(t).toContain("Instagram · @sofronovaaaaaa");
    expect(t).toContain("🧾 Заказ #131 · Палитра средств выразительности · 1700 ₸ · ждёт оплаты");
    // Три последние реплики, первая (оформление заказа) уже не влезает.
    expect(t).toContain("<i>Покупатель, ");
    expect(t).toContain("💳 Картой РФ");
    expect(t).toContain("<i>Бот, ");
    expect(t).not.toContain("Выберите способ оплаты");
    // Цитата уже среди реплик — отдельной строкой «…» не дублируется.
    expect(t).not.toContain("«Здравствуйте Не получается оплатить»");
    expect(t.length).toBeLessThan(4096);
    expect(buttons[0]).toEqual([
      [
        { text: "👤 Профиль", url: "https://instagram.com/sofronovaaaaaa" },
        { text: "✉️ Написать в Direct", url: "https://ig.me/m/sofronovaaaaaa" },
      ],
      [{ text: "Открыть диалог", url: "https://app.test/admin/chat?c=131" }],
    ]);
  });

  it("ссылки на покупателя: ник Instagram и Telegram, id Meta вместо ника — без ссылок", () => {
    expect(contactLinks({ platform: "instagram", username: "a.b_c" })?.chat).toBe(
      "https://ig.me/m/a.b_c",
    );
    expect(contactLinks({ platform: "instagram", username: "1098354232682939" })).toBeNull();
    expect(contactLinks({ platform: "telegram", username: "kristina_u" })?.profile).toBe(
      "https://t.me/kristina_u",
    );
    expect(contactLinks({ platform: "whatsapp", username: "77001234567" })).toBeNull();
    expect(contactLinks(undefined)).toBeNull();
  });

  it("длинная переписка и ответ — подсказка не длиннее предела Telegram", () => {
    const long = "я".repeat(5000);
    const r = sellerSignal(
      "ru",
      {
        telegramId: 1,
        kind: "upset",
        audience: "seller",
        quote: long.slice(0, 300),
        summary: long.slice(0, 500),
        reply: long.slice(0, 700),
      },
      {
        who: "Instagram · @a",
        contact: { platform: "instagram", username: "a" },
        lines: [1, 2, 3].map((i) => ({
          id: String(i),
          telegramId: 1,
          sender: "customer",
          text: long,
          at: new Date(NOW).toISOString(),
          fresh: true,
        })),
        orders: [],
      },
      "https://x/admin/chat?c=1",
      "Asia/Almaty",
    );
    expect(r.html.length).toBeLessThanOrEqual(SIGNAL_MAX_CHARS);
    expect(r.buttons).toHaveLength(2);
  });

  it("по тому же диалогу через 15 минут — в журнал, продавцу второй раз не пишем", async () => {
    say(77, "customer", 6, "Как оплатить из Беларуси?");
    await runDialogObserver(tenant(), budget, deps(() => flag(77)).d);
    say(77, "customer", -10, "Ау?");
    const later = deps(() => flag(77, "unanswered"), NOW + 15 * 60_000);
    const r = await runDialogObserver(tenant(), budget, later.d);
    expect(r).toMatchObject({ findings: 1, sent: 0, held: 1 });
    expect(later.seller).toHaveLength(0);
    // Новое окно: прошлые реплики модель видит только как историю.
    expect(later.calls[0]!.user).toContain("* [");
    expect(later.calls[0]!.user).toMatch(/ {2}\[[^\n]*Как оплатить из Беларуси/);
  });

  it("два прогона разом — модель зовёт и продавцу пишет только один", async () => {
    say(77, "customer", 6, "Как оплатить из Беларуси?");
    const a = deps(() => flag(77));
    const b = deps(() => flag(77));
    const [ra, rb] = await Promise.all([
      runDialogObserver(tenant(), budget, a.d),
      runDialogObserver(tenant(), budget, b.d),
    ]);
    expect([ra, rb].filter((r) => "skipped" in r && r.skipped === "busy")).toHaveLength(1);
    expect(a.seller.length + b.seller.length).toBe(1);
    expect(a.calls.length + b.calls.length).toBe(1);
  });

  it("сбой платформы — оператору, продавцу нет", async () => {
    say(5, "customer", 3, "Нажимаю Купить, ничего не происходит");
    const x = deps(() => flag(5, "bug", "system"));
    await runDialogObserver(tenant(), budget, x.d);
    expect(x.seller).toHaveLength(0);
    expect(x.operator).toHaveLength(1);
    expect(x.operator[0]).toContain("похоже на сбой");
    expect(x.operator[0]).toContain("/operator/clients/");
  });

  it("вопрос два часа без ответа попадает к модели, даже если новых реплик нет", async () => {
    say(9, "customer", 124, "А есть папка МО для начальных классов?");
    say(9, "bot", 124, "Передаю ваш вопрос продавцу.");
    const x = deps(() => ({ findings: [] }));
    db.tables.app_settings!.push({
      bot_id: KOPILKA,
      key: OBSERVER_STATE_KEY,
      value: JSON.stringify({
        cursor: ago(15),
        signals: {},
        spend: { date: "2026-10-10", usd: 0, calls: 0 },
      }),
      updated_at: ago(15),
    });
    const r = await runDialogObserver(tenant(), budget, x.d);
    expect(r).toMatchObject({ dialogs: 1 });
    expect(x.calls[0]!.user).toContain("ответа нет 2 ч");
  });

  it("ответ продавца после вопроса — ждущим не считается", async () => {
    say(9, "customer", 130, "А есть папка МО?");
    say(9, "manager", 125, "Есть, пришлю.");
    db.tables.app_settings!.push({
      bot_id: KOPILKA,
      key: OBSERVER_STATE_KEY,
      value: JSON.stringify({
        cursor: ago(15),
        signals: {},
        spend: { date: "2026-10-10", usd: 0, calls: 0 },
      }),
      updated_at: ago(15),
    });
    const x = deps(() => ({ findings: [] }));
    expect(await runDialogObserver(tenant(), budget, x.d)).toMatchObject({ dialogs: 0 });
    expect(x.calls).toHaveLength(0);
  });

  it("потолок расхода за день — модель не зовём, оператору одно сообщение", async () => {
    say(77, "customer", 6, "Цена?");
    db.tables.app_settings!.push({
      bot_id: KOPILKA,
      key: OBSERVER_STATE_KEY,
      value: JSON.stringify({
        cursor: ago(15),
        signals: {},
        spend: { date: "2026-10-10", usd: 2.01, calls: 400 },
      }),
      updated_at: ago(15),
    });
    const x = deps(() => flag(77));
    expect(await runDialogObserver(tenant(), budget, x.d)).toEqual({ skipped: "cap" });
    expect(await runDialogObserver(tenant(), budget, x.d)).toEqual({ skipped: "cap" });
    expect(x.calls).toHaveLength(0);
    expect(x.operator).toHaveLength(1);
    expect(x.operator[0]).toContain("остановлен до завтра");
  });

  it("модель не ответила — без сигналов, сбой в итоге прогона", async () => {
    say(77, "customer", 6, "Цена?");
    const x = deps(() => {
      throw new Error("529 overloaded");
    });
    const r = await runDialogObserver(tenant(), budget, x.d);
    expect(r).toMatchObject({ failed: 1, findings: 0, error: "529 overloaded" });
    expect(x.seller).toHaveLength(0);
  });
});

describe("наблюдатель: дешёвый отсев до модели", () => {
  it("обычный ход покупки (ключевое слово, кнопки, бот ответил) — модель не зовём", async () => {
    say(3, "customer", 8, "Палитра");
    say(3, "bot", 8, "Палитра — 1700 ₸. Нажмите «Купить».");
    say(3, "customer", 7, "Купить");
    say(3, "bot", 7, "Оформить заказ?");
    const x = deps(() => flag(3));
    const r = await runDialogObserver(tenant(), budget, x.d);
    expect(r).toMatchObject({ dialogs: 0, calm: 1, usd: 0 });
    expect(x.calls).toHaveLength(0);
  });

  it("бот дважды прислал одно и то же — к модели", async () => {
    say(4, "customer", 8, "Купить");
    say(4, "bot", 8, "Оформить заказ?");
    say(4, "bot", 8, "Оформить заказ?");
    const x = deps(() => ({ findings: [] }));
    expect(await runDialogObserver(tenant(), budget, x.d)).toMatchObject({ dialogs: 1 });
  });

  it("бот передал продавцу — к модели", async () => {
    say(6, "customer", 8, "Здравствуйте");
    say(6, "bot", 8, "Передаю ваш вопрос продавцу, он скоро ответит.");
    const x = deps(() => ({ findings: [] }));
    expect(await runDialogObserver(tenant(), budget, x.d)).toMatchObject({ dialogs: 1 });
  });
});

describe("наблюдатель: «оплата зависла» сверяется с заказом", () => {
  const order = (status: string) =>
    db.tables.orders!.push({
      id: 4154,
      order_no: 102,
      display_no: 102,
      bot_id: KOPILKA,
      telegram_id: 8,
      status,
      total: 1700,
      currency: "KZT",
      created_at: ago(17),
    });
  const stuck = () => flag(8, "payment_stuck", "both");

  it("заказ уже оплачен и выдан (Продамус) — продавцу и оператору не пишем, в журнале «оплачен»", async () => {
    order("delivered");
    say(8, "customer", 6, "Оплатила");
    say(8, "bot", 6, "Оплата — по кнопке в сообщении выше; после оплаты заказ подтвердится сам.");
    const x = deps(() => stuck());
    const r = await runDialogObserver(tenant(), budget, x.d);
    expect(r).toMatchObject({ findings: 1, sent: 0 });
    expect(x.seller).toHaveLength(0);
    expect(x.operator).toHaveLength(0);
    // Модель видит статус словами, а не «delivered».
    expect(x.calls[0]!.user).toContain("№102 оплачен и выдан");
    const log = JSON.parse(setting(observerLogKey("2026-10-10"))!);
    expect(log).toMatchObject([{ tid: 8, kind: "payment_stuck", sent: "settled" }]);
  });

  it("заказ ждёт оплаты — сигнал уходит продавцу", async () => {
    order("awaiting_payment");
    say(8, "customer", 6, "Оплатила");
    const x = deps(() => stuck());
    await runDialogObserver(tenant(), budget, x.d);
    expect(x.seller).toHaveLength(1);
  });

  it("заказ оплатили, пока думала модель — статус читаем заново", async () => {
    order("awaiting_payment");
    say(8, "customer", 6, "Оплатила");
    const x = deps(() => {
      db.tables.orders![0]!.status = "paid";
      return stuck();
    });
    await runDialogObserver(tenant(), budget, x.d);
    expect(x.seller).toHaveLength(0);
  });
});

describe("наблюдатель: разбор ответа модели и тексты", () => {
  it("чужие id, неизвестные виды и вторая находка по диалогу отбрасываются", () => {
    const f = parseFindings(
      {
        findings: [
          {
            dialog_id: "1",
            kind: "wholesale",
            audience: "seller",
            quote: "q",
            summary: "s",
            reply: "r",
          },
          {
            dialog_id: "1",
            kind: "upset",
            audience: "seller",
            quote: "q",
            summary: "s",
            reply: "r",
          },
          {
            dialog_id: "2",
            kind: "weather",
            audience: "seller",
            quote: "q",
            summary: "s",
            reply: "r",
          },
          { dialog_id: "3", kind: "bug", audience: "system", quote: "q", summary: "s", reply: "r" },
          {
            dialog_id: "99",
            kind: "bug",
            audience: "system",
            quote: "q",
            summary: "s",
            reply: "r",
          },
        ],
      },
      new Set([1, 2, 3]),
    );
    expect(f.map((x) => [x.telegramId, x.kind, x.reply])).toEqual([
      [1, "wholesale", "r"],
      [3, "bug", ""],
    ]);
    expect(parseFindings(null, new Set([1]))).toEqual([]);
  });

  it("подсказка продавцу — на всех четырёх языках и без HTML из реплик", () => {
    for (const l of SUPPORTED_LOCALES) {
      const t = sellerSignalText(
        l,
        {
          telegramId: 1,
          kind: "wholesale",
          audience: "seller",
          quote: "<b>50 шт</b>",
          summary: "s",
          reply: "r",
        },
        "Instagram · @a",
        "https://x/admin/chat?c=1",
      );
      expect(t).toContain("&lt;b&gt;50 шт&lt;/b&gt;");
      expect(t).toContain('href="https://x/admin/chat?c=1"');
      // Наблюдатель не видит сообщений с файлами — не обещаем, что покупателю «ничего не отправлено».
      expect(t).not.toMatch(
        /ничего не отправлено|nothing was sent|ештеңе жіберілген|hech narsa yuborilmadi/,
      );
    }
  });
});
