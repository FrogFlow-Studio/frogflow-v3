import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  isoWeekKey,
  renderWeekly,
  weeklyChange,
  weeklyDuration,
  weekWindow,
  WEEKLY_SENT_KEY,
  type WeeklyStats,
} from "./weekly";
import {
  sendWeeklyReport,
  WEEKLY_MAX_ATTEMPTS,
  WeeklySendError,
  weeklyPermanentFailure,
} from "./weekly.server";

const TZ = "Asia/Almaty"; // UTC+5
// Понедельник 28.09.2026, 9:30 в Алматы.
const MONDAY_0930 = new Date("2026-09-28T04:30:00Z");

describe("окно недели", () => {
  it("в понедельник с 9:00 — прошлая неделя пн–вс по поясу магазина", () => {
    const w = weekWindow(MONDAY_0930, TZ);
    expect(w).toMatchObject({ week: "2026-W39", due: true, label: "21.09–27.09" });
    expect(w.from.toISOString()).toBe("2026-09-20T19:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-09-27T19:00:00.000Z");
    expect(w.prevFrom.toISOString()).toBe("2026-09-13T19:00:00.000Z");
  });
  it("в понедельник до 9:00 ещё рано, во вторник — пора (если крон пропустил)", () => {
    expect(weekWindow(new Date("2026-09-28T03:00:00Z"), TZ).due).toBe(false);
    expect(weekWindow(new Date("2026-09-29T01:00:00Z"), TZ)).toMatchObject({
      week: "2026-W39",
      due: true,
    });
  });
  it("номер недели по ISO на стыке лет", () => {
    expect(isoWeekKey(2025, 12, 29)).toBe("2026-W01");
    expect(isoWeekKey(2027, 1, 3)).toBe("2026-W53");
  });
});

describe("текст отчёта", () => {
  it("выручка с изменением, воронка с долями, лучший канал, топ-3", () => {
    const html = renderWeekly("21.09–27.09", {
      currency: "KZT",
      revenue: 150000,
      orders: 12,
      prevRevenue: 100000,
      prevOrders: 12,
      funnel: [
        { channel: "all", arrived: 40, cart: 20, ordered: 15, paid: 12 },
        { channel: "telegram", arrived: 30, cart: 12, ordered: 9, paid: 7 },
        { channel: "instagram", arrived: 10, cart: 8, ordered: 6, paid: 5 },
      ],
      top: [
        { name: "Прописи <A4>", qty: 5 },
        { name: "Азбука", qty: 3 },
        { name: "Пазл", qty: 2 },
        { name: "Лишний", qty: 1 },
      ],
    });
    expect(html).toContain("Итоги недели 21.09–27.09");
    expect(html).toContain("150000 ₸ (▲ 50 % к прошлой неделе)");
    expect(html).toContain("Оплаченных заказов: 12\n");
    expect(html).toContain("Корзина: 20 (50 %)");
    expect(html).toContain("Лучший канал: Telegram (оплатили 7)");
    expect(html).toContain("1. Прописи &lt;A4&gt; — 5 шт.");
    expect(html).not.toContain("Лишний");
  });
});

const BASE: WeeklyStats = {
  currency: "KZT",
  revenue: 150000,
  orders: 12,
  prevRevenue: 100000,
  prevOrders: 12,
  funnel: [{ channel: "all", arrived: 40, cart: 20, ordered: 15, paid: 12 }],
  top: [],
  speed: { payMedian: 12, payP90: 90, deliverMedian: 1, autoShare: 80 },
  buyers: { fresh: 10, returning: 15, prevReturning: 15 },
};

describe("недельный отчёт: скорость, вернувшиеся, что изменилось", () => {
  it("на четырёх языках: скорость и выдача, доля без продавца, вернувшиеся, изменение", () => {
    const want: Record<"ru" | "kk" | "en" | "uz", string[]> = {
      ru: [
        "Скорость: оплата — медиана 12 мин, 90 % заказов — до 1 ч 30 мин; выдача после оплаты — 1 мин",
        "Выдано без вашего участия: 80 %",
        "Вернувшихся покупателей: 15 (новых 10)",
        "Что изменилось: выручка ▲ 50 %",
      ],
      kk: [
        "Жылдамдық: төлем — медиана 12 мин, тапсырыстардың 90 % — 1 сағ 30 мин дейін; төлемнен кейін беру — 1 мин",
        "Сіздің қатысуыңызсыз берілді: 80 %",
        "Қайта оралған сатып алушылар: 15 (жаңа 10)",
        "Не өзгерді: түсім ▲ 50 %",
      ],
      en: [
        "Speed: payment — median 12 min, 90% of orders within 1 h 30 min; delivery after payment — 1 min",
        "Delivered without your action: 80%",
        "Returning customers: 15 (new 10)",
        "What changed: revenue ▲ 50%",
      ],
      uz: [
        "Tezlik: to‘lov — mediana 12 daq, buyurtmalarning 90 % i 1 soat 30 daq gacha; to‘lovdan keyin topshirish — 1 daq",
        "Sizning ishtirokingizsiz topshirilgan: 80 %",
        "Qaytgan xaridorlar: 15 (yangi 10)",
        "Nima o‘zgardi: tushum ▲ 50 %",
      ],
    };
    for (const lang of ["ru", "kk", "en", "uz"] as const) {
      const html = renderWeekly("21.09–27.09", BASE, lang);
      for (const line of want[lang]) expect(html).toContain(line);
    }
  });

  it("без данных о скорости и покупателях строк нет, остальной отчёт прежний", () => {
    const html = renderWeekly("21.09–27.09", { ...BASE, speed: null, buyers: null });
    expect(html).not.toContain("Скорость");
    expect(html).not.toContain("Вернувшихся");
    expect(html).toContain("Выручка: 150000 ₸ (▲ 50 % к прошлой неделе)");
  });

  it("что изменилось: самый большой сдвиг; мелочь — без заметных", () => {
    expect(
      weeklyChange({ ...BASE, buyers: { fresh: 1, returning: 3, prevReturning: 12 } }),
    ).toEqual({ metric: "returning", pct: -75 });
    expect(
      weeklyChange({
        ...BASE,
        revenue: 102000,
        buyers: { fresh: 1, returning: 15, prevReturning: 15 },
      }),
    ).toBeNull();
    const calm = renderWeekly("x", { ...BASE, revenue: 102000 }, "en");
    expect(calm).toContain("What changed: nothing notable vs last week");
  });

  it("длительность: минуты, часы, дни", () => {
    expect(weeklyDuration(0)).toBe("0 мин");
    expect(weeklyDuration(59.6)).toBe("1 ч");
    expect(weeklyDuration(150, "en")).toBe("2 h 30 min");
    expect(weeklyDuration(1500)).toBe("1 дн 1 ч");
  });
});

function shop(settings: Record<string, string> = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = Object.entries(settings).map(([key, value]) => ({
    bot_id: "t1",
    key,
    value,
  }));
  db.tables.bot_users = [
    { user_key: "tg_1", platform: "telegram", created_at: "2026-09-22T08:00:00Z" },
  ];
  db.tables.cart_items = [];
  db.tables.orders = [
    {
      id: 1,
      user_key: "tg_1",
      telegram_id: 1,
      platform: "telegram",
      status: "delivered",
      fulfillment_kind: "digital",
      total: 5000,
      paid_amount: 5000,
      currency: "KZT",
      created_at: "2026-09-23T08:00:00Z",
    },
  ];
  db.tables.order_items = [
    {
      id: "i1",
      order_id: 1,
      product_id: "p1",
      name_snapshot: "Азбука",
      price_snapshot: 5000,
      quantity: 1,
    },
  ];
  const ctx = { db, tenant: { id: "t1", settings: {} }, timezone: TZ } as unknown as TenantContext;
  const sent = (db: ReturnType<typeof fakeDb>) =>
    db.tables.app_settings!.find((s) => s.key === WEEKLY_SENT_KEY)?.value;
  return { db, ctx, sent: () => sent(db) };
}

describe("отправка отчёта", () => {
  it("отправляет итоги прошлой недели один раз, второй прогон крона — ничего", async () => {
    const { ctx, sent } = shop();
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, MONDAY_0930)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const html = send.mock.calls[0]![0];
    expect(html).toContain("Выручка: 5000 ₸");
    expect(html).toContain("1. Азбука — 1 шт.");
    expect(sent()).toBe("2026-W39");
    const later = new Date(MONDAY_0930.getTime() + 15 * 60_000);
    expect(await sendWeeklyReport(ctx, send, later)).toBe("already");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("два прогона крона одновременно — отчёт уходит один раз", async () => {
    const { ctx } = shop();
    const send = vi.fn(async (_html: string) => 1);
    const r = await Promise.all([
      sendWeeklyReport(ctx, send, MONDAY_0930),
      sendWeeklyReport(ctx, send, MONDAY_0930),
      sendWeeklyReport(ctx, send, MONDAY_0930),
    ]);
    expect(r.filter((x) => x === "sent")).toHaveLength(1);
    expect(r.filter((x) => x === "already")).toHaveLength(2);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("выключен в настройках — не отправляет и ничего не пишет", async () => {
    const { ctx, sent } = shop({ weekly_report_enabled: "false" });
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, MONDAY_0930)).toBe("off");
    expect(send).not.toHaveBeenCalled();
    expect(sent()).toBeUndefined();
  });

  it("до 9 утра понедельника не отправляет; через неделю — следующий отчёт", async () => {
    const { ctx, sent } = shop({ weekly_report_enabled: "true" });
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, new Date("2026-09-28T03:00:00Z"))).toBe("notDue");
    expect(send).not.toHaveBeenCalled();
    await sendWeeklyReport(ctx, send, MONDAY_0930);
    const nextMonday = new Date(MONDAY_0930.getTime() + 7 * 86_400_000);
    expect(await sendWeeklyReport(ctx, send, nextMonday)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(2);
    expect(sent()).toBe("2026-W40");
  });
});

describe("отправка отчёта: скорость и вернувшиеся из журнала заказов", () => {
  it("скорость недели и вернувшиеся попадают в отчёт на языке админки", async () => {
    const { db, ctx } = shop({ admin_locale: "en" });
    db.tables.orders!.push({
      id: 2,
      user_key: "tg_1",
      telegram_id: 1,
      platform: "telegram",
      status: "delivered",
      fulfillment_kind: "digital",
      total: 3000,
      paid_amount: 3000,
      currency: "KZT",
      created_at: "2026-09-24T08:00:00Z",
    });
    const ev = (id: string, order: number, kind: string, at: string, extra = {}) => ({
      id,
      bot_id: "t1",
      event_id: `order:${order}:${kind}:${id}`,
      event_type: `order.${kind}`,
      status: "event",
      created_at: at,
      payload: { order_id: order, actor: "bot", ...extra },
    });
    db.tables.zernio_logs = [
      ev("a", 1, "placed", "2026-09-23T08:00:00Z", { platform: "telegram" }),
      ev("b", 1, "payment", "2026-09-23T08:10:00Z", { actor: "system" }),
      ev("c", 1, "delivered", "2026-09-23T08:11:00Z"),
      ev("d", 2, "placed", "2026-09-24T08:00:00Z", { platform: "telegram" }),
      ev("e", 2, "delivery_started", "2026-09-24T09:00:00Z", { actor: "admin:anna" }),
      ev("f", 2, "delivered", "2026-09-24T09:01:00Z"),
    ];
    const send = vi.fn(async (_html: string) => 1);
    expect(await sendWeeklyReport(ctx, send, MONDAY_0930)).toBe("sent");
    const html = send.mock.calls[0]![0];
    expect(html).toContain("Week results 21.09–27.09");
    expect(html).toContain("Speed: payment — median 10 min, 90% of orders within 1 h");
    expect(html).toContain("delivery after payment — 1 min");
    expect(html).toContain("Delivered without your action: 50%");
    // Покупатель tg_1: первая покупка 23.09, вторая 24.09 — в той же неделе: новый, не вернувшийся.
    expect(html).toContain("Returning customers: 0 (new 1)");
  });
});

describe("сбой отправки отчёта", () => {
  it("сбой по пути — отметка недели снята, следующий прогон отправляет", async () => {
    const { ctx, sent } = shop();
    const broken = vi.fn(async (_html: string): Promise<number> => {
      throw new Error("fetch failed: ECONNRESET");
    });
    const err = await sendWeeklyReport(ctx, broken, MONDAY_0930).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WeeklySendError);
    expect((err as WeeklySendError).permanent).toBe(false);
    expect(sent()).not.toBe("2026-W39");
    const send = vi.fn(async (_html: string) => 1);
    const later = new Date(MONDAY_0930.getTime() + 15 * 60_000);
    expect(await sendWeeklyReport(ctx, send, later)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(sent()).toBe("2026-W39");
  });

  it("бот заблокирован или токен неверный — отметка остаётся, повторов нет", async () => {
    for (const reason of ["Forbidden: bot was blocked by the user", "401: Unauthorized"]) {
      const { ctx, sent } = shop();
      const broken = vi.fn(async (_html: string): Promise<number> => {
        throw new Error(reason);
      });
      const err = await sendWeeklyReport(ctx, broken, MONDAY_0930).catch((e: unknown) => e);
      expect((err as WeeklySendError).permanent).toBe(true);
      expect(sent()).toBe("2026-W39");
      const later = new Date(MONDAY_0930.getTime() + 15 * 60_000);
      expect(await sendWeeklyReport(ctx, broken, later)).toBe("already");
      expect(broken).toHaveBeenCalledTimes(1);
    }
  });

  it("классификация отказов", () => {
    expect(weeklyPermanentFailure("Forbidden: bot was blocked by the user")).toBe(true);
    expect(weeklyPermanentFailure("Unauthorized")).toBe(true);
    expect(weeklyPermanentFailure("fetch failed")).toBe(false);
    expect(weeklyPermanentFailure("relation app_settings timeout")).toBe(false);
  });
});

describe("отказ канала до подсчёта и лимит повторов", () => {
  it.each([
    "Секрет не зашифрован: ожидался формат enc:v1:…",
    "Повреждённый зашифрованный секрет",
    "Unsupported state or unable to authenticate data",
    "У клиента «X» не подключён Telegram-бот (нет токена)",
  ])(
    "токен «%s» — постоянный отказ: неделя отмечена сразу, без отправки и повторов",
    async (msg) => {
      const { ctx, sent } = shop();
      const send = vi.fn(async (_html: string) => 1);
      const ready = () => {
        throw new Error(msg);
      };
      const err = await sendWeeklyReport(ctx, send, MONDAY_0930, { ready }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(WeeklySendError);
      expect((err as WeeklySendError).permanent).toBe(true);
      expect(sent()).toBe("2026-W39");
      expect(send).not.toHaveBeenCalled();
      const later = new Date(MONDAY_0930.getTime() + 15 * 60_000);
      expect(await sendWeeklyReport(ctx, send, later, { ready })).toBe("already");
      expect(weeklyPermanentFailure(msg)).toBe(true);
    },
  );

  it("временные сбои — не больше 4 попыток за неделю, потом отметка остаётся", async () => {
    const { ctx, sent } = shop();
    const broken = vi.fn(async (_html: string): Promise<number> => {
      throw new Error("fetch failed");
    });
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      const at = new Date(MONDAY_0930.getTime() + i * 15 * 60_000);
      const r = await sendWeeklyReport(ctx, broken, at).catch((e: unknown) => e);
      if (r instanceof WeeklySendError) results.push(r.permanent);
    }
    expect(broken).toHaveBeenCalledTimes(WEEKLY_MAX_ATTEMPTS);
    expect(results).toEqual([false, false, false, true]);
    expect(sent()).toBe("2026-W39");
  });
});
