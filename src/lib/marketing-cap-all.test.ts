import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { sendCartReminders } from "@/core/reminders/cart";
import { runWinback } from "@/core/winback/winback";
import { runFunnel } from "@/core/funnel/funnel";
import { runBirthdays } from "@/core/funnel/birthday";
import { runSimilar } from "@/core/similar/similar";
import { runReviewAsk } from "@/core/reviews/ask";

/**
 * Д4: «не больше одного маркетингового сообщения в сутки на покупателя» для всех
 * автосообщений вместе, не только для каждого по отдельности. Каждое задание
 * гоняется на настоящем коде и базе в памяти; проверяется то, что записано:
 * сколько раз вызвана отправка и что осталось в state покупателя.
 */
const DAY = 86_400_000;
// 11:00 в Алматы.
const NOW = new Date("2026-09-27T06:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const P = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const C = "c0000000-0000-4000-8000-00000000000a";

type Db = ReturnType<typeof fakeDb>;
const stateOf = (db: Db) => db.tables.bot_users![0]!.state as Record<string, unknown>;

function base(modules: Record<string, boolean>, state: Record<string, unknown> = {}) {
  const db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.app_settings = [];
  db.tables.blocked_users = [];
  db.tables.manager_chat_messages = [];
  db.tables.product_reviews = [];
  db.tables.bot_users = [
    {
      user_key: "tg_1",
      telegram_id: 1,
      platform: "telegram",
      first_name: "Аня",
      opt_out: false,
      cart_reminder_sent_at: null,
      state,
      created_at: ago(3),
    },
  ];
  db.tables.orders = [];
  db.tables.order_items = [];
  const ctx = {
    tenant: { id: "bot", modules, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const setting = (db: Db, key: string, value: unknown) =>
  db.tables.app_settings!.push({ key, value: JSON.stringify(value) });

type Job = {
  name: string;
  /** Покупатель подходит заданию; возвращает запуск. */
  arrange: (state: Record<string, unknown>) => {
    db: Db;
    ctx: TenantContext;
    run: (send: () => Promise<boolean>) => Promise<unknown>;
  };
};

const JOBS: Job[] = [
  {
    name: "напоминание о корзине",
    arrange: (state) => {
      const { db, ctx } = base({ cart_reminder: true }, state);
      db.tables.cart_items = [
        {
          id: "c1",
          telegram_id: 1,
          quantity: 1,
          product_variant_id: null,
          created_at: ago(1),
          products: {
            id: P(1),
            name: "Торт",
            price: 5000,
            currency: "KZT",
            country_prices: {},
            is_active: true,
            stock_quantity: null,
            fulfillment_kind: "physical",
          },
          product_variants: null,
        },
      ];
      return { db, ctx, run: (send) => sendCartReminders(ctx, send, NOW) };
    },
  },
  {
    name: "возврат клиентов",
    arrange: (state) => {
      const { db, ctx } = base({ winback: true }, state);
      setting(db, "winback", { enabled: true, days1: 30, promo: "BACK" });
      db.tables.orders = [
        { id: 10, telegram_id: 1, platform: "telegram", status: "delivered", created_at: ago(40) },
      ];
      return { db, ctx, run: (send) => runWinback(ctx, send, NOW) };
    },
  },
  {
    name: "автоворонка",
    arrange: (state) => {
      const { db, ctx } = base({ funnel: true }, state);
      setting(db, "funnel", {
        enabled: true,
        stopOnOrder: false,
        steps: [{ afterHours: 24, text: "{name}, заходите", catalogButton: true }],
      });
      return { db, ctx, run: (send) => runFunnel(ctx, send, NOW) };
    },
  },
  {
    name: "поздравление с днём рождения",
    arrange: (state) => {
      const { db, ctx } = base({ funnel: true }, { birthday: "09-27", ...state });
      setting(db, "birthday_greeting", {
        enabled: true,
        text: "{name}, с днём рождения!",
        promo: "",
      });
      return { db, ctx, run: (send) => runBirthdays(ctx, send, NOW) };
    },
  },
  {
    name: "«похожие материалы»",
    arrange: (state) => {
      const { db, ctx } = base({ winback: true }, state);
      setting(db, "similar_materials", { enabled: true, days: 7, text: "{name}, смотрите:" });
      db.tables.products = [1, 2, 3].map((n) => ({
        id: P(n),
        name: `Товар ${n}`,
        category_id: null,
        category_ids: [C],
        sort_order: n,
        stock_quantity: null,
        is_active: true,
      }));
      db.tables.categories = [{ id: C, parent_id: null, is_visible: true }];
      db.tables.orders = [
        { id: 10, telegram_id: 1, platform: "telegram", status: "delivered", created_at: ago(8) },
      ];
      db.tables.order_items = [{ order_id: 10, product_id: P(1) }];
      return { db, ctx, run: (send) => runSimilar(ctx, send, NOW) };
    },
  },
  {
    name: "просьба об оценке",
    arrange: (state) => {
      const { db, ctx } = base({ review_request: true }, state);
      db.tables.orders = [
        {
          id: 10,
          telegram_id: 1,
          platform: "telegram",
          display_no: 10,
          order_no: 10,
          status: "delivered",
          updated_at: ago(4),
          created_at: ago(6),
        },
      ];
      db.tables.order_items = [{ order_id: 10, product_id: P(1), name_snapshot: "Прописи" }];
      return { db, ctx, run: (send) => runReviewAsk(ctx, send as never, NOW) };
    },
  },
];

describe("потолок «одно маркетинговое в сутки»: каждое автосообщение его уважает", () => {
  for (const job of JOBS) {
    it(`${job.name}: сегодня уже писали — не пишет и ничего не отмечает`, async () => {
      const t = job.arrange({ marketing_times: [hoursAgo(2)], last_marketing_at: hoursAgo(2) });
      const send = vi.fn(async () => true);
      await t.run(send);
      expect(send).not.toHaveBeenCalled();
      expect(stateOf(t.db).marketing_times).toEqual([hoursAgo(2)]);
    });

    it(`${job.name}: вчерашнее сообщение потолок не занимает — пишет один раз и занимает место`, async () => {
      const t = job.arrange({ marketing_times: [hoursAgo(30)], last_marketing_at: hoursAgo(30) });
      const send = vi.fn(async () => true);
      await t.run(send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(stateOf(t.db).marketing_times as string[]).toContain(NOW.toISOString());
      // Второй прогон в тот же день — потолок.
      await t.run(send);
      expect(send).toHaveBeenCalledTimes(1);
    });
  }

  it("поздравление ждёт, пока потолок занят, и не теряется: отметка года не ставится", async () => {
    const t = JOBS[3]!.arrange({ marketing_times: [hoursAgo(2)], last_marketing_at: hoursAgo(2) });
    await t.run(vi.fn(async () => true));
    expect(stateOf(t.db).birthday_sent).toBeUndefined();
  });
});

describe("все автосообщения разом на одного покупателя", () => {
  /** Покупатель подходит корзине, воронке и поздравлению сразу. */
  function everything() {
    const cart = JOBS[0]!.arrange({ birthday: "09-27" });
    const { db, ctx } = cart;
    setting(db, "funnel", {
      enabled: true,
      stopOnOrder: false,
      steps: [{ afterHours: 24, text: "{name}, заходите", catalogButton: true }],
    });
    setting(db, "birthday_greeting", {
      enabled: true,
      text: "{name}, с днём рождения!",
      promo: "",
    });
    (ctx.tenant.modules as Record<string, boolean>).funnel = true;
    const send = vi.fn(async () => true);
    const jobs = [
      () => runBirthdays(ctx, send, NOW),
      () => sendCartReminders(ctx, send, NOW),
      () => runFunnel(ctx, send, NOW),
    ];
    const all = () => jobs.map((j) => j());
    const oneByOne = async () => {
      for (const j of jobs) await j();
    };
    return { db, ctx, send, all, oneByOne };
  }

  it("друг за другом: одно сообщение за день, в state одна отметка", async () => {
    const t = everything();
    await t.oneByOne();
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(stateOf(t.db).marketing_times).toHaveLength(1);
  });

  it("два крона одновременно, каждый со всеми заданиями: по-прежнему одно", async () => {
    const t = everything();
    await Promise.all([...t.all(), ...t.all()]);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(stateOf(t.db).marketing_times).toHaveLength(1);
  });

  it("потолок «2»: друг за другом ровно два, одновременно — не больше двух", async () => {
    const seq = everything();
    seq.db.tables.app_settings!.push({ key: "marketing_daily_cap", value: "2" });
    await seq.oneByOne();
    expect(seq.send).toHaveBeenCalledTimes(2);
    expect(stateOf(seq.db).marketing_times).toHaveLength(2);

    const par = everything();
    par.db.tables.app_settings!.push({ key: "marketing_daily_cap", value: "2" });
    await Promise.all([...par.all(), ...par.all()]);
    expect(par.send.mock.calls.length).toBeLessThanOrEqual(2);
    expect(par.send.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect((stateOf(par.db).marketing_times as string[]).length).toBe(par.send.mock.calls.length);
  });
});
