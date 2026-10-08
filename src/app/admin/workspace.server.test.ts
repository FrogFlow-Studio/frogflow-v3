import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";
import { consultantJournal, consultantOverview, JOURNAL_PAGE } from "./workspace.server";

/** Рабочее место консультанта без продаж: «Обзор» и журнал ответов по диалогу. */
let n = 0;
function ctxOf() {
  // Свой арендатор на тест: прайс и курс кэшируются по арендатору.
  const id = `20000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const now = "2026-10-08T06:00:00.000Z";
  db.tables.app_settings = [
    { bot_id: id, key: "consultant_enabled", value: "true", updated_at: now },
    {
      bot_id: id,
      key: "consultant_daily",
      value: JSON.stringify({ date: "2026-10-08", usd: 4.5, calls: 10, tests: 0 }),
      updated_at: now,
    },
    {
      bot_id: id,
      key: "consultant_catalog_json",
      value: JSON.stringify([
        {
          id: "T1",
          name: "Uchino полотенце",
          category: "Полотенца",
          size: "50x100",
          colors: [],
          price_kzt: 9000,
          stock: true,
        },
      ]),
      updated_at: now,
    },
    {
      bot_id: id,
      key: "consultant_tasks_json",
      value: JSON.stringify([
        {
          id: "t1",
          at: "2026-10-08T05:00:00.000Z",
          userKey: "ig:1",
          reason: "purchase",
          text: "Берёт",
          done: false,
        },
        {
          id: "t2",
          at: "2026-10-07T05:00:00.000Z",
          userKey: "ig:2",
          reason: "wholesale",
          text: "Опт",
          done: true,
        },
      ]),
      updated_at: now,
    },
  ];
  db.tables.bot_users = [{ bot_id: id, user_key: "ig:1", telegram_id: -501 }];
  db.tables.consultant_message_runs = [
    run(id, "a", "c1", "replied", "reply", "2026-10-08T03:00:00.000Z"),
    run(id, "b", "c1", "replied", "handoff:purchase", "2026-10-08T05:00:00.000Z"),
    run(id, "c", "c2", "cancelled", "paused", "2026-10-07T05:00:00.000Z"),
  ];
  const ctx = {
    tenant: {
      id,
      name: "BOVI",
      vertical: "consultant",
      modules: { manager_chat: true },
      settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
    },
    db,
    timezone: "Asia/Almaty",
    appUrl: "https://app.test",
  } as unknown as TenantContext;
  return { ctx, db };
}

function run(bot: string, id: string, conv: string, status: string, kind: string, at: string) {
  return {
    id: `00000000-0000-4000-8000-00000000000${id === "a" ? 1 : id === "b" ? 2 : 3}`,
    bot_id: bot,
    message_id: id,
    conversation_id: conv,
    user_key: "ig:1",
    status,
    incoming_text: `вопрос ${id}`,
    reply_text: status === "replied" ? `ответ ${id}` : null,
    reply_kind: kind,
    received_at: at,
    token_usage: { usd: id === "a" ? 0.01 : id === "b" ? 0.02 : 0.03 },
  };
}

describe("«Обзор» консультанта", () => {
  it("сегодня по журналу, открытые задачи со ссылкой в диалог, расход и предел", async () => {
    const { ctx } = ctxOf();
    const o = await consultantOverview(ctx, { contacts: true }, new Date("2026-10-08T07:00:00Z"));
    expect(o.today).toEqual({
      date: "2026-10-08",
      dialogs: 1,
      replies: 2,
      handoffs: 1,
      silent: 0,
      usd: expect.closeTo(0.03, 6),
    });
    // «Итого» за неделю: два разных диалога (c1, c2), расход по журналу ответов.
    expect(o.weekTotal).toMatchObject({ dialogs: 2, replies: 2, handoffs: 1, silent: 1 });
    expect(o.weekTotal.usd).toBeCloseTo(0.06, 6);
    expect(o.week.find((d) => d.date === "2026-10-07")).toMatchObject({ silent: 1 });
    expect(o.tasks?.open).toBe(1);
    expect(o.tasks?.top).toEqual([expect.objectContaining({ id: "t1", telegramId: -501 })]);
    expect(o.spend).toEqual({ usd: 4.5, limitUsd: 5 });
    expect(o.alerts.map((a) => a.key)).toContain("limitNear");
    expect(o.alerts.map((a) => a.key)).toContain("rateNone");
  });

  it("роль без доступа к контактам — без задач (в них имена и телефоны)", async () => {
    const { ctx } = ctxOf();
    const o = await consultantOverview(ctx, { contacts: false });
    expect(o.tasks).toBeNull();
  });

  it("журнал не прочитался — ошибка, а не «сегодня ноль»", async () => {
    const { ctx, db } = ctxOf();
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table === "consultant_message_runs")
        q.range = (() => Promise.resolve({ data: null, error: { message: "timeout" } })) as never;
      return q;
    };
    await expect(consultantOverview(ctx, { contacts: true })).rejects.toThrow();
  });
});

describe("журнал ответов по диалогу", () => {
  it("свежие сверху, с исходом хода; страница и признак «есть ещё»", async () => {
    const { ctx, db } = ctxOf();
    const page = await consultantJournal(ctx, "ig:1");
    expect(page.entries.map((e) => e.question)).toEqual(["вопрос b", "вопрос a", "вопрос c"]);
    expect(page.entries[0]!.outcome).toEqual({ kind: "handoff", reason: "purchase" });
    expect(page.entries[2]!.outcome).toEqual({ kind: "silent", why: "paused" });
    expect(page.hasMore).toBe(false);
    for (let i = 0; i < JOURNAL_PAGE; i++)
      db.tables.consultant_message_runs!.push({
        ...run(ctx.tenant.id, "a", "c1", "replied", "reply", "2026-10-01T00:00:00.000Z"),
        id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        message_id: `m${i}`,
      });
    const first = await consultantJournal(ctx, "ig:1");
    expect(first.entries).toHaveLength(JOURNAL_PAGE);
    expect(first.hasMore).toBe(true);
    const second = await consultantJournal(ctx, "ig:1", first.next);
    expect(second.entries).toHaveLength(3);
    expect(second.hasMore).toBe(false);
    // Чужой покупатель — пусто.
    expect((await consultantJournal(ctx, "ig:9")).entries).toEqual([]);
  });
});
