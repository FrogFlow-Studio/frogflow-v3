import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { orderChatId } from "./order-chat";

vi.mock("@/config/env", () => ({ env: () => ({ SECRETS_KEY: "s", APP_URL: "https://a.test" }) }));
const { liveReminders } = await import("./live-remind.server");
const { courseReminders } = await import("./reminders.server");
const { courseSegmentMembers } = await import("./segment.server");
const { runKey } = await import("./run.server");

/** Ш2 партии 13: напоминания ученику, купившему на сайте после входа через Telegram. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const C1 = "cccccccc-0000-4000-8000-000000000001";
const L1 = "00000000-0000-4000-8000-000000000001";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [{ id: L1, title: "К", text: "т", files: [], link: null }],
  cohorts: [
    {
      id: C1,
      title: "Октябрь",
      start: "2026-10-15T10:00",
      enrollUntil: null,
      lives: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          title: "Разбор",
          at: "2026-10-20T19:00",
          link: null,
        },
      ],
    },
  ],
};

function school(platform: string, telegramId: number) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: null, name_snapshot: "Курс" },
  ];
  db.tables.orders = [
    {
      id: 7,
      status: "delivered",
      platform,
      telegram_id: telegramId,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(course) },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({
        startedAt: "2026-10-01T00:00:00Z",
        done: [],
        notified: 0,
        cohortId: C1,
      }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: { slug: "school" } },
    db,
    appUrl: "https://a.test",
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return ctx;
}

describe("настоящий чат ученика не зависит от канала заказа", () => {
  it("orderChatId: положительный id — чат, синтетический и пустой — нет", () => {
    expect(orderChatId({ telegram_id: 555 })).toBe(555);
    expect(orderChatId({ telegram_id: "555" })).toBe(555);
    expect(orderChatId({ telegram_id: -42 })).toBeNull();
    expect(orderChatId({ telegram_id: null })).toBeNull();
  });

  it("напоминание об эфире: заказ web с настоящим id получает сообщение", async () => {
    const sent: Array<{ telegramId: number }> = [];
    const stats = await liveReminders(
      school("web", 555),
      async (r) => (sent.push(r), true),
      new Date("2026-10-20T15:00:00Z"),
    );
    expect(stats).toMatchObject({ sent: 1, silent: 0 });
    expect(sent.map((s) => s.telegramId)).toEqual([555]);
  });

  it("напоминание об эфире: покупатель из почты (синтетический id) — тихо", async () => {
    const stats = await liveReminders(
      school("web", -123456),
      async () => true,
      new Date("2026-10-20T15:00:00Z"),
    );
    expect(stats).toMatchObject({ sent: 0, silent: 1 });
  });

  it("напоминание до старта: заказ web с настоящим id получает сообщение", async () => {
    const sent: Array<{ kind: string; telegramId: number }> = [];
    await courseReminders(
      school("web", 555),
      async (x) => (sent.push(x), true),
      null,
      new Date("2026-10-12T08:00:00Z"),
    );
    expect(sent.map((s) => s.telegramId)).toEqual([555]);
  });

  it("сегмент рассылки «все ученики»: заказ web с настоящим id входит", async () => {
    const ids = await courseSegmentMembers(
      school("web", 555),
      P,
      "all",
      null,
      new Date("2026-10-16T00:00:00Z"),
    );
    expect([...ids]).toEqual([555]);
  });
});
