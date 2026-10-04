import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { liveMark, liveReminderDue } from "./live-remind";
import type { LiveReminder } from "./live-remind.server";

vi.mock("@/config/env", () => ({ env: () => ({ SECRETS_KEY: "s", APP_URL: "https://a.test" }) }));
const { liveReminders } = await import("./live-remind.server");
const { runKey, parseRun } = await import("./run.server");

/** Напоминания об эфирах (Ш3): за сутки и за час, один раз, тихие часы, гонка двух кронов. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V = "bbbbbbbb-0000-4000-8000-000000000001";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const LIVE = "e0000000-0000-4000-8000-000000000001";
const live = (at: string, link: string | null = "https://zoom.us/j/9") => ({
  id: LIVE,
  title: "Разбор",
  at,
  link,
});
const course = (lives: ReturnType<typeof live>[], accessDays: number | null = null): Course => ({
  schedule: { mode: "all" },
  lessons: [
    { id: "00000000-0000-4000-8000-000000000001", title: "К", text: "т", files: [], link: null },
  ],
  cohorts: [{ id: C1, title: "Октябрь", start: "2026-10-15T10:00", enrollUntil: null, lives }],
  tariffs: { [V]: { homework: true, channel: true, accessDays } },
});

// Москва, UTC+3: 19:00 по Москве = 16:00 UTC.
function school(c: Course, platform = "telegram") {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: V, name_snapshot: "Аквагрим" },
  ];
  db.tables.orders = [
    { id: 7, status: "delivered", platform, telegram_id: 555, created_at: "2026-10-01T00:00:00Z" },
  ];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(c) },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [], cohortId: C1 }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: { slug: "school" } },
    db,
    appUrl: "https://a.test",
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, db };
}
const marks = (db: ReturnType<typeof fakeDb>) =>
  parseRun(
    (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === runKey("item-1"),
    )!.value,
  )!.liveReminded ?? [];
function collector() {
  const sent: LiveReminder[] = [];
  return { sent, send: async (x: LiveReminder) => (sent.push(x), true) };
}

describe("правила напоминаний", () => {
  const start = Date.parse("2026-10-20T16:00:00Z");
  const m = {
    day: liveMark(LIVE, "2026-10-20T19:00", "day"),
    hour: liveMark(LIVE, "2026-10-20T19:00", "hour"),
  };
  const due = (leftMin: number, daytime = true, have: string[] = []) =>
    liveReminderDue(start, start - leftMin * 60_000, daytime, new Set(have), m)?.kind ?? null;
  it("сутки — от 24 ч днём; час — от 60 мин в любое время; после начала — ничего", () => {
    expect(due(25 * 60)).toBeNull();
    expect(due(24 * 60)).toBe("day");
    expect(due(24 * 60, false)).toBeNull();
    expect(due(60, false)).toBe("hour");
    expect(due(61)).toBe("day");
    expect(due(0)).toBeNull();
    expect(due(-5)).toBeNull();
  });
  it("отмеченное не повторяется; «час» закрывает и «сутки»", () => {
    expect(due(24 * 60, true, [m.day])).toBeNull();
    expect(due(60, true, [m.hour])).toBeNull();
    expect(liveReminderDue(start, start - 30 * 60_000, true, new Set(), m)?.mark).toEqual([
      m.day,
      m.hour,
    ]);
  });
  it("перенос эфира меняет метку", () => {
    expect(liveMark(LIVE, "2026-10-20T19:00", "day")).not.toBe(
      liveMark(LIVE, "2026-10-21T19:00", "day"),
    );
  });
});

describe("напоминания об эфире", () => {
  it("за сутки одно, за час одно со ссылкой; повторные прогоны молчат", async () => {
    const { ctx } = school(course([live("2026-10-20T19:00")]));
    const { sent, send } = collector();
    for (const at of [
      "2026-10-19T12:00:00Z", // ещё больше суток (28 ч)
      "2026-10-19T16:00:00Z", // ровно сутки, 19:00 по Москве — день
      "2026-10-19T16:10:00Z",
      "2026-10-20T10:00:00Z",
      "2026-10-20T15:00:00Z", // час
      "2026-10-20T15:10:00Z",
      "2026-10-20T16:30:00Z", // уже идёт
    ])
      await liveReminders(ctx, send, new Date(at));
    expect(sent.map((s) => [s.kind, s.link, s.at])).toEqual([
      ["day", null, "2026-10-20T19:00"],
      ["hour", "https://zoom.us/j/9", "2026-10-20T19:00"],
    ]);
    expect(sent[0]!.telegramId).toBe(555);
    expect(sent[0]!.url).toMatch(/^https:\/\/a\.test\/s\/school\/course\/item-1\?k=/);
  });

  it("ночью суточное ждёт утра; часовое уходит и ночью", async () => {
    const { ctx } = school(course([live("2026-10-20T08:00")])); // 05:00 UTC
    const { sent, send } = collector();
    await liveReminders(ctx, send, new Date("2026-10-19T05:30:00Z")); // 08:30 МСК — ещё ночь
    expect(sent).toHaveLength(0);
    await liveReminders(ctx, send, new Date("2026-10-19T07:00:00Z")); // 10:00 МСК
    expect(sent.map((s) => s.kind)).toEqual(["day"]);

    const night = school(course([live("2026-10-20T01:00")])); // 22:00 UTC накануне = 01:00 МСК
    const n = collector();
    await liveReminders(night.ctx, n.send, new Date("2026-10-19T21:05:00Z")); // 00:05 МСК, час до эфира
    expect(n.sent.map((s) => s.kind)).toEqual(["hour"]);
  });

  it("два крона одновременно: одно сообщение, одна отметка", async () => {
    const { ctx, db } = school(course([live("2026-10-20T19:00")]));
    const { sent, send } = collector();
    const slow = async (x: LiveReminder) => {
      await new Promise((r) => setTimeout(r, 15));
      return send(x);
    };
    const now = new Date("2026-10-20T15:05:00Z");
    await Promise.all([liveReminders(ctx, slow, now), liveReminders(ctx, slow, now)]);
    expect(sent.map((s) => s.kind)).toEqual(["hour"]);
    expect(marks(db)).toHaveLength(2);
  });

  it("сбой отправки не повторяется: метка уже стоит", async () => {
    const { ctx } = school(course([live("2026-10-20T19:00")]));
    const calls: string[] = [];
    const fail = async (x: LiveReminder) => (calls.push(x.kind), Promise.reject(new Error("5xx")));
    const now = new Date("2026-10-20T15:05:00Z");
    expect(await liveReminders(ctx, fail, now)).toMatchObject({ failed: 1, sent: 0 });
    await liveReminders(ctx, fail, new Date("2026-10-20T15:15:00Z"));
    expect(calls).toEqual(["hour"]);
  });

  it("закончился доступ — ни одного; из Instagram — только отметка, без отправки", async () => {
    const ended = school(course([live("2026-11-20T19:00")], 30)); // доступ 30 дней от 15 октября
    const a = collector();
    await liveReminders(ended.ctx, a.send, new Date("2026-11-20T15:05:00Z"));
    expect(a.sent).toEqual([]);
    expect(marks(ended.db)).toEqual([]);

    const ig = school(course([live("2026-10-20T19:00")]), "instagram");
    const b = collector();
    expect(await liveReminders(ig.ctx, b.send, new Date("2026-10-20T15:05:00Z"))).toMatchObject({
      silent: 1,
      sent: 0,
    });
    expect(marks(ig.db)).toHaveLength(2);
  });

  it("перенесённый эфир получает напоминание заново; метки убранных эфиров не копятся", async () => {
    const { ctx, db } = school(course([live("2026-10-20T19:00")]));
    const { sent, send } = collector();
    await liveReminders(ctx, send, new Date("2026-10-20T15:05:00Z"));
    const row = (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === courseKey(P),
    )!;
    row.value = JSON.stringify(course([live("2026-10-22T19:00")])); // перенесли на два дня
    await liveReminders(ctx, send, new Date("2026-10-22T15:05:00Z"));
    expect(sent.map((s) => [s.kind, s.at])).toEqual([
      ["hour", "2026-10-20T19:00"],
      ["hour", "2026-10-22T19:00"],
    ]);
    // метки старого времени отброшены: остались только метки нового
    expect(marks(db).every((x) => x.includes("202610221900"))).toBe(true);
  });

  it("модуль выключен — пропуск", async () => {
    const { ctx } = school(course([live("2026-10-20T19:00")]));
    (ctx.tenant as { modules: Record<string, boolean> }).modules = {};
    expect(await liveReminders(ctx, async () => true)).toEqual({ skipped: "module off" });
  });
});
