import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  parseEscalate,
  parseUnansweredMinutes,
  remindUnanswered,
  UNANSWERED_ESCALATION_EVENT_TYPE,
  UNANSWERED_EVENT_TYPE,
  type UnansweredDialog,
} from "./unanswered";

const NOW = new Date("2026-09-27T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function shop() {
  const db: FakeDb = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.manager_chat_state = [];
  db.tables.manager_chat_messages = [];
  db.tables.zernio_logs = [];
  const ctx = { tenant: { id: "bot-1" }, db } as unknown as TenantContext;
  let seq = 0;
  const dialog = (
    telegramId: number,
    active: boolean,
    msgs: Array<[sender: "customer" | "bot" | "manager", minAgo: number, text?: string]>,
  ) => {
    db.tables.manager_chat_state!.push({
      bot_id: "bot-1",
      telegram_id: telegramId,
      active,
      last_message_at: ago(Math.min(...msgs.map((m) => m[1]))),
      unread_count: 0,
    });
    for (const [sender, min, text] of msgs)
      db.tables.manager_chat_messages!.push({
        id: `m${++seq}`,
        bot_id: "bot-1",
        telegram_id: telegramId,
        direction: sender === "customer" ? "in" : "out",
        sender,
        text: text ?? sender,
        created_at: ago(min),
      });
  };
  return { db, ctx, dialog };
}

async function run(ctx: TenantContext, minutes = 30) {
  const got: UnansweredDialog[] = [];
  const r = await remindUnanswered(
    ctx,
    minutes,
    async (d) => {
      got.push(d);
    },
    NOW,
  );
  return { r, got };
}

describe("напоминание о диалоге без ответа", () => {
  it("подключён продавец, покупатель ждёт 40 минут — одно напоминание, с первой реплики ожидания", async () => {
    const { ctx, dialog } = shop();
    dialog(1, true, [
      ["manager", 60],
      ["customer", 40, "а когда?"],
      ["bot", 39],
      ["customer", 35, "ау"],
    ]);
    const first = await run(ctx);
    expect(first.got).toHaveLength(1);
    expect(first.got[0]).toMatchObject({ telegramId: 1, waitingSince: ago(40), lastText: "ау" });
    // Следующий запуск крона — тишина: отметка уже стоит.
    expect((await run(ctx)).got).toHaveLength(0);
  });

  it("два крона одновременно — одно напоминание", async () => {
    const { ctx, dialog } = shop();
    dialog(1, true, [
      ["manager", 60],
      ["customer", 40, "а когда?"],
    ]);
    const [a, b] = await Promise.all([run(ctx), run(ctx)]);
    expect(a.got.length + b.got.length).toBe(1);
    expect(a.r.reminded + b.r.reminded).toBe(1);
  });

  it("ответ продавца открывает новый отрезок: новое ожидание — новое напоминание", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 90]]);
    expect((await run(ctx)).got).toHaveLength(1);
    db.tables.manager_chat_messages!.push(
      {
        id: "x1",
        bot_id: "bot-1",
        telegram_id: 1,
        direction: "out",
        sender: "manager",
        text: "да",
        created_at: ago(80),
      },
      {
        id: "x2",
        bot_id: "bot-1",
        telegram_id: 1,
        direction: "in",
        sender: "customer",
        text: "спасибо, а ещё?",
        created_at: ago(45),
      },
    );
    expect((await run(ctx)).got.map((d) => d.waitingSince)).toEqual([ago(45)]);
  });

  it("рано, уже ответили, бот ведёт диалог сам, диалог решён — не напоминаем", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 10]]); // ещё рано
    dialog(2, true, [
      ["customer", 50],
      ["manager", 45],
    ]); // ответили
    dialog(3, false, [["customer", 50]]); // никто не подключён — отвечает бот
    dialog(4, true, [["customer", 50]]);
    db.tables.zernio_logs!.push({
      bot_id: "bot-1",
      event_id: "inbox:bot-1:4",
      event_type: "inbox",
      status: "closed",
      payload: { telegram_id: 4 },
      created_at: ago(1),
    });
    dialog(5, true, [["customer", 5 * 24 * 60]]); // старше трёх суток
    expect((await run(ctx)).got).toEqual([]);
  });

  it("ответственный или открытое обращение — ждут человека и без подключения", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, false, [["customer", 50]]);
    dialog(2, false, [
      ["customer", 50],
      ["bot", 49, "Обращение #7 создано"],
    ]);
    db.tables.zernio_logs!.push(
      {
        bot_id: "bot-1",
        event_id: "inbox:bot-1:1",
        event_type: "inbox",
        status: "open",
        payload: { telegram_id: 1, assignee: "anna" },
        created_at: ago(1),
      },
      {
        bot_id: "bot-1",
        event_id: "ticket:bot-1:7",
        event_type: "ticket",
        status: "open",
        payload: { telegram_id: 2, number: 7 },
        created_at: ago(49),
      },
    );
    const { got } = await run(ctx);
    expect(got.map((d) => [d.telegramId, d.assignee]).sort()).toEqual([
      [1, "anna"],
      [2, null],
    ]);
    expect(
      db.tables.zernio_logs!.filter((r) => r.event_type === UNANSWERED_EVENT_TYPE),
    ).toHaveLength(2);
  });

  it("новые реплики покупателя (хоть 60) не дают второго напоминания в том же ожидании", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [
      ["manager", 200],
      ...Array.from({ length: 60 }, (_, i) => ["customer", 100 - i] as ["customer", number]),
    ]);
    expect((await run(ctx)).got).toHaveLength(1);
    db.tables.manager_chat_messages!.push({
      id: "late",
      bot_id: "bot-1",
      telegram_id: 1,
      direction: "in",
      sender: "customer",
      text: "ну что?",
      created_at: ago(2),
    });
    db.tables.manager_chat_state![0]!.last_message_at = ago(2);
    expect((await run(ctx)).got).toHaveLength(0);
  });

  it("сбой чтения базы — ошибка, а не напоминания закрытым диалогам", async () => {
    const { ctx, dialog } = shop();
    dialog(1, true, [["customer", 50]]);
    // Любой запрос к zernio_logs (учёт входящих, обращения) падает.
    const failing: unknown = new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === "then"
          ? (res: (v: unknown) => void) => res({ data: null, error: { message: "timeout" } })
          : () => failing,
    });
    const db = ctx.db as unknown as { from: (t: string) => unknown };
    const real = db.from.bind(db);
    db.from = (t: string) => (t === "zernio_logs" ? failing : real(t));
    await expect(run(ctx)).rejects.toThrow(/timeout/);
  });

  it("выключено — ни одного запроса к диалогам", async () => {
    const { ctx, dialog } = shop();
    dialog(1, true, [["customer", 500]]);
    expect((await run(ctx, 0)).got).toEqual([]);
  });

  it("настройка: только разрешённые значения, мусор — выключено", () => {
    expect(parseUnansweredMinutes("30")).toBe(30);
    expect(parseUnansweredMinutes("7")).toBe(0);
    expect(parseUnansweredMinutes(null)).toBe(0);
  });
});

describe("второй шаг: владельцу, если ответственный молчит", () => {
  /** Проход крона с обоими шагами; в `second` — кому ушёл второй шаг. */
  async function pass(ctx: TenantContext, minutes = 30, now = NOW) {
    const first: UnansweredDialog[] = [];
    const second: UnansweredDialog[] = [];
    const r = await remindUnanswered(
      ctx,
      minutes,
      async (d) => void first.push(d),
      now,
      async (d) => void second.push(d),
    );
    return { r, first, second };
  }
  /** Первое напоминание «ушло» `min` минут назад. */
  const backdate = (db: FakeDb, min: number) => {
    for (const r of db.tables.zernio_logs!)
      if (r.event_type === UNANSWERED_EVENT_TYPE) r.created_at = ago(min);
  };

  it("первое напоминание — сразу, второе — только через столько же минут и один раз", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 50, "где заказ?"]]);
    const a = await pass(ctx);
    expect(a.first).toHaveLength(1);
    expect(a.second).toHaveLength(0); // только что напомнили
    backdate(db, 10);
    expect((await pass(ctx)).second).toHaveLength(0); // прошло 10 из 30
    backdate(db, 31);
    const b = await pass(ctx);
    expect(b.first).toHaveLength(0);
    expect(b.second).toMatchObject([
      { telegramId: 1, waitingSince: ago(50), lastText: "где заказ?" },
    ]);
    expect(
      db.tables.zernio_logs!.filter((r) => r.event_type === UNANSWERED_ESCALATION_EVENT_TYPE),
    ).toHaveLength(1);
    expect((await pass(ctx)).second).toHaveLength(0); // третьего не будет
  });

  it("два крона одновременно — одно второе сообщение", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 90]]);
    await pass(ctx);
    backdate(db, 40);
    const [a, b] = await Promise.all([pass(ctx), pass(ctx)]);
    expect(a.second.length + b.second.length).toBe(1);
    expect(a.r.escalated + b.r.escalated).toBe(1);
  });

  it("продавец ответил между шагами — второго шага нет; новое ожидание идёт заново", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 90]]);
    await pass(ctx);
    backdate(db, 40);
    db.tables.manager_chat_messages!.push({
      id: "reply",
      bot_id: "bot-1",
      telegram_id: 1,
      direction: "out",
      sender: "manager",
      text: "уже смотрю",
      created_at: ago(20),
    });
    expect((await pass(ctx)).second).toHaveLength(0);
    // Покупатель написал снова после ответа: свой отрезок, своё первое напоминание.
    db.tables.manager_chat_messages!.push({
      id: "again",
      bot_id: "bot-1",
      telegram_id: 1,
      direction: "in",
      sender: "customer",
      text: "ау?",
      created_at: ago(15),
    });
    db.tables.manager_chat_state![0]!.last_message_at = ago(15);
    const next = await pass(ctx, 10);
    expect(next.first.map((d) => d.waitingSince)).toEqual([ago(15)]);
    expect(next.second).toHaveLength(0);
  });

  it("диалог закрыт после первого напоминания — владельца не беспокоим", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 90]]);
    await pass(ctx);
    backdate(db, 40);
    db.tables.zernio_logs!.push({
      bot_id: "bot-1",
      event_id: "inbox:bot-1:1",
      event_type: "inbox",
      status: "closed",
      payload: { telegram_id: 1 },
      created_at: ago(1),
    });
    expect((await pass(ctx)).second).toHaveLength(0);
  });

  it("без второго уведомителя второй шаг не выполняется и не отмечается", async () => {
    const { ctx, db, dialog } = shop();
    dialog(1, true, [["customer", 90]]);
    await run(ctx);
    backdate(db, 40);
    expect((await run(ctx)).r).toMatchObject({ reminded: 0, escalated: 0 });
    expect(
      db.tables.zernio_logs!.filter((r) => r.event_type === UNANSWERED_ESCALATION_EVENT_TYPE),
    ).toHaveLength(0);
  });

  it("настройка второго шага: включено только значением «1»", () => {
    expect(parseEscalate("1")).toBe(true);
    expect(parseEscalate("0")).toBe(false);
    expect(parseEscalate(null)).toBe(false);
  });
});
