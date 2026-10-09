import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";
import { fetchWithin, sendPricelistFollowUps } from "./consultant-jobs.server";
import type { ZernioTransport } from "./api.server";

/**
 * Напоминание замолчавшему покупателю (шаг 16 переноса BOVI): одно на
 * паузу, в окне Instagram, свой голос запоминается — проверка «в чате
 * менеджер» не примет напоминание за человека.
 */
const now = new Date("2026-09-25T08:00:00Z"); // 13:00 по Алматы
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

function ctxOf(followUp: string | null = "on"): TenantContext {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    ...(followUp === null ? [] : [{ bot_id: "b1", key: "consultant_followup", value: followUp }]),
    {
      bot_id: "b1",
      key: "consultant_catalog_json",
      value: JSON.stringify([
        {
          id: "zt",
          name: "Uchino Полотенце махровое Zero Twist, 70x140, цвет белый",
          category: "Полотенца",
          size: "70x140",
          colors: ["белый"],
          price_kzt: 55000,
          stock: true,
        },
      ]),
    },
  ];
  const consultant = {
    recent: [
      { role: "customer", text: "Сколько Zero Twist?" },
      { role: "assistant", text: "55 000 ₸." },
    ],
    last_product_ids: ["zt"],
    last_reply_at: hoursAgo(4),
  };
  db.tables.bot_users = [
    {
      bot_id: "b1",
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      zernio_conversation_id: "conv1",
      zernio_account_id: "acc1",
      updated_at: hoursAgo(4),
      state: { consultant },
    },
    {
      bot_id: "b1",
      user_key: "ig_2",
      platform: "instagram",
      telegram_id: -2,
      zernio_conversation_id: "conv2",
      zernio_account_id: "acc1",
      updated_at: hoursAgo(1),
      state: { consultant: { ...consultant, last_reply_at: hoursAgo(1) } },
    },
  ];
  return {
    tenant: {
      id: `b1-${Math.random()}`,
      settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
      modules: {},
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

type Tail = Awaited<ReturnType<ZernioTransport["tail"]>>;
/** Покупатель спросил за минуту до ответа бота, бот ответил — тишина. */
const asked = (h = 4.1) =>
  [
    { direction: "incoming", message: "Сколько Zero Twist?", createdAt: hoursAgo(h) },
    { direction: "outgoing", message: "55 000 ₸.", createdAt: hoursAgo(4) },
  ] as Tail;
const transport = (tail: () => Promise<Tail> = async () => asked()) => {
  const send = vi.fn(async () => ({ ok: true as const }));
  return { t: { send, tail: vi.fn(tail) } as unknown as ZernioTransport, send };
};
const consultantOf = (ctx: TenantContext, key: string) =>
  (
    (
      ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> }
    ).tables.bot_users!.find((r) => r.user_key === key)!.state as {
      consultant: Record<string, unknown>;
    }
  ).consultant;

describe("напоминание замолчавшему покупателю", () => {
  it("тишина 4 часа после ответа с товаром — одно напоминание, второй крон не повторяет", async () => {
    const ctx = ctxOf();
    const { t, send } = transport();
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      "conv1",
      "acc1",
      "Остались вопросы по Uchino Полотенце махровое Zero Twist? Подскажу по размеру, цвету или доставке.",
      expect.objectContaining({ platform: "instagram" }),
    ]);
    const c = consultantOf(ctx, "ig_1");
    expect(c.relayed).toEqual([expect.stringContaining("Остались вопросы")]);
    expect((c.recent as { text: string }[]).at(-1)!.text).toContain("Остались вопросы");
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("покупатель выбрал казахский — напоминание на казахском (а без выбора — язык магазина)", async () => {
    const ctx = ctxOf();
    const rows = (ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> })
      .tables.bot_users!;
    rows[0]!.state = { ...(rows[0]!.state as object), locale: "kk" };
    const { t, send } = transport();
    await sendPricelistFollowUps(ctx, now, t);
    expect((send.mock.calls[0] as unknown[])[2]).toContain("бойынша сұрақтарыңыз қалды ма?");

    const uz = ctxOf();
    (uz.tenant.settings as { default_locale?: string }).default_locale = "uz";
    const second = transport();
    await sendPricelistFollowUps(uz, now, second.t);
    expect((second.send.mock.calls[0] as unknown[])[2]).toContain("savollaringiz qoldimi?");
  });

  it("два крона одновременно — одно напоминание", async () => {
    const ctx = ctxOf();
    const { t, send } = transport();
    const [a, b] = await Promise.all([
      sendPricelistFollowUps(ctx, now, t),
      sendPricelistFollowUps(ctx, now, t),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("менеджер ответил из приложения после бота — напоминания нет, диалог отмечен", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(
      async () =>
        [
          { direction: "incoming", message: "Сколько Zero Twist?", createdAt: hoursAgo(4.1) },
          { direction: "outgoing", message: "55 000 ₸.", createdAt: hoursAgo(4) },
          {
            direction: "outgoing",
            message: "Добрый день! Могу оформить доставку",
            createdAt: hoursAgo(2),
          },
        ] as Tail,
    );
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0, manager: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(consultantOf(ctx, "ig_1").followup_for).toBe(hoursAgo(4));
    expect(consultantOf(ctx, "ig_1").relayed).toBeUndefined();
  });

  it("в хвосте только вопрос покупателя и наши ответы — напоминание уходит", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(async () => asked());
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("строки настройки нет — напоминание включено (BOVI 09.10: молчало без неё)", async () => {
    const { t, send } = transport();
    expect(await sendPricelistFollowUps(ctxOf(null), now, t)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("покупатель писал больше 23 часов назад — окно Instagram закрывается: не пишем, отмечаем", async () => {
    // Бот ответил с опозданием: по ответу бота 4 часа, по сообщению покупателя — 23,5.
    const ctx = ctxOf();
    const { t, send } = transport(async () => asked(23.5));
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0, window: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(consultantOf(ctx, "ig_1").followup_for).toBe(hoursAgo(4));
    // Отмечено — следующий крон переписку уже не читает.
    const again = transport();
    expect(await sendPricelistFollowUps(ctx, now, again.t)).toMatchObject({ sent: 0 });
    expect(again.t.tail).not.toHaveBeenCalled();
  });

  it("покупатель писал 22 часа назад — окно ещё открыто, напоминание уходит", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(async () => asked(22));
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("в ленте нет сообщений покупателя — окно не проверить: не пишем", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(
      async () => [{ direction: "outgoing", message: "55 000 ₸.", createdAt: hoursAgo(4) }] as Tail,
    );
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0, window: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("покупатель написал после ответа бота — он не замолчал: не пишем и не отмечаем", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(
      async () =>
        [
          ...asked(),
          { direction: "incoming", message: "А доставка?", createdAt: hoursAgo(1) },
        ] as Tail,
    );
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(consultantOf(ctx, "ig_1").followup_for).toBeUndefined();
  });

  it("по покупателю открыта задача продавцу — не пишем; сделанная задача не мешает", async () => {
    const task = (done: boolean) => ({
      bot_id: "b1",
      key: "consultant_tasks_json",
      value: JSON.stringify([
        { id: "t1", at: hoursAgo(3.5), userKey: "ig_1", reason: "wholesale", text: "опт", done },
      ]),
    });
    const tables = (c: TenantContext) =>
      (c.db as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables;

    const open = ctxOf();
    tables(open).app_settings!.push(task(false));
    const a = transport();
    expect(await sendPricelistFollowUps(open, now, a.t)).toMatchObject({ sent: 0, task: 1 });
    expect(a.send).not.toHaveBeenCalled();
    expect(consultantOf(open, "ig_1").followup_for).toBe(hoursAgo(4));

    const done = ctxOf();
    tables(done).app_settings!.push(task(true));
    const b = transport();
    expect(await sendPricelistFollowUps(done, now, b.t)).toMatchObject({ sent: 1 });
  });

  it("задачи не прочитались — никому не пишем", async () => {
    const ctx = ctxOf();
    // Чтение строки задач падает, остальные настройки читаются как обычно.
    type Q = { eq: (k: string, v: unknown) => unknown };
    const db = ctx.db as unknown as { from: (t: string) => { select: (c?: string) => Q } };
    const from = db.from.bind(db);
    db.from = (t: string) => {
      const q = from(t);
      if (t !== "app_settings") return q;
      return {
        ...q,
        select: (c?: string) => {
          const sel = q.select(c);
          return {
            ...sel,
            eq: (k: string, v: unknown) =>
              k === "key" && v === "consultant_tasks_json"
                ? { maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }
                : sel.eq(k, v),
          };
        },
      };
    };
    const { t, send } = transport();
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({
      sent: 0,
      skipped: "tasks_unreadable",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("переписку не прочитали — не пишем и не отмечаем: решит следующий крон", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(async () => {
      throw new Error("Zernio API 500");
    });
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(consultantOf(ctx, "ig_1").followup_for).toBeUndefined();
  });

  it("выключено у продавца или ночью — не пишем", async () => {
    const { t, send } = transport();
    expect(await sendPricelistFollowUps(ctxOf("off"), now, t)).toMatchObject({ skipped: "off" });
    const night = new Date("2026-09-25T18:00:00Z"); // 23:00 по Алматы
    expect(await sendPricelistFollowUps(ctxOf(), night, t)).toMatchObject({
      skipped: "off_hours",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("сводка качества за сутки", () => {
  const morning = new Date("2026-09-26T04:30:00Z"); // 9:30 по Алматы
  const withRuns = (on: string) => {
    const ctx = ctxOf();
    const tables = (ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> })
      .tables;
    tables.app_settings!.push({ bot_id: "b1", key: "consultant_quality_digest", value: on });
    tables.consultant_message_runs = [
      {
        bot_id: "b1",
        message_id: "m1",
        conversation_id: "c1",
        incoming_text: "Цена?",
        reply_text: "Отличный выбор! Премиальные полотенца. Какой размер? Какой цвет?",
        reply_kind: "reply",
        status: "replied",
        model: "claude-haiku-4-5",
        token_usage: { usd: 0.01 },
        received_at: "2026-09-25T08:00:00.000Z",
      },
    ];
    return ctx;
  };

  it("утром — сводка за вчера продавцу, один раз в сутки", async () => {
    const ctx = withRuns("on");
    const sent: string[] = [];
    const notify = async (_c: unknown, html: string) => (sent.push(html), 1);
    const { sendQualityDigest } = await import("./consultant-jobs.server");
    expect(await sendQualityDigest(ctx, morning, notify)).toEqual({ sent: true });
    expect(sent[0]).toContain("Консультант за 25.09");
    expect(sent[0]).toContain("рекламные слова");
    expect(await sendQualityDigest(ctx, morning, notify)).toMatchObject({ reason: "already" });
    expect(sent).toHaveLength(1);
  });

  it("два крона одновременно — одна сводка", async () => {
    const ctx = withRuns("on");
    const sent: string[] = [];
    const notify = async (_c: unknown, html: string) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(html);
      return 1;
    };
    const { sendQualityDigest } = await import("./consultant-jobs.server");
    await Promise.all([
      sendQualityDigest(ctx, morning, notify),
      sendQualityDigest(ctx, morning, notify),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("выключена или рано — не шлём", async () => {
    const { sendQualityDigest } = await import("./consultant-jobs.server");
    const notify = vi.fn(async () => 1);
    expect(await sendQualityDigest(withRuns("off"), morning, notify)).toMatchObject({
      reason: "off",
    });
    expect(
      await sendQualityDigest(withRuns("on"), new Date("2026-09-26T02:00:00Z"), notify),
    ).toMatchObject({ reason: "early" });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("скачивание таблицы прайса в кроне", () => {
  it("общий срок на все запросы одного магазина: после него следующий запрос прерван", async () => {
    const seen: AbortSignal[] = [];
    const base = async (_url: string, init: RequestInit) => {
      seen.push(init.signal!);
      return new Response("ok");
    };
    const f = fetchWithin(30, base);
    await f("https://docs.google.com/a", { signal: AbortSignal.timeout(60_000) });
    expect(seen[0]!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    await f("https://docs.google.com/b", {});
    expect(seen[1]!.aborted).toBe(true);
    // Свой тайм-аут запроса тоже действует: сигнал первого запроса прерван общим сроком.
    expect(seen[0]!.aborted).toBe(true);
  });
});
