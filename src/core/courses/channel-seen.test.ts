import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import {
  channelStrangers,
  kickChannelStranger,
  recordChannelSighting,
} from "./channel-seen.server";
import { inviteKey } from "./channel.server";
import { runKey } from "./run.server";

/** Сверка «в канале, но без доступа»: видим вступивших, сравниваем с покупками. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V = "bbbbbbbb-0000-4000-8000-000000000001";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [],
  tariffs: { [V]: { homework: true, channel: true, accessDays: 30 } },
  channel: "-1001234567890",
};
const CHAT = { id: -1001234567890 };
const NOW = new Date("2026-10-10T10:00:00Z");

function school() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: V, name_snapshot: "К" },
    { id: "item-2", order_id: 8, product_id: P, product_variant_id: V, name_snapshot: "К" },
  ];
  db.tables.orders = [
    {
      id: 7,
      status: "delivered",
      platform: "telegram",
      telegram_id: 555,
      created_at: "2026-10-01T00:00:00Z",
    },
    // возврат: заказ уже не «выдан»
    {
      id: 8,
      status: "refunded",
      platform: "telegram",
      telegram_id: 777,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(course) },
    {
      bot_id: T,
      key: runKey("item-1"),
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [], notified: 0 }),
    },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: true } },
    db,
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
  return { ctx, db };
}

describe("в канале без доступа", () => {
  it("покупатель не в списке, посторонний, вернувший деньги и вышедший — по делу", async () => {
    const { ctx } = school();
    for (const id of [555, 777, 999])
      await recordChannelSighting(ctx, CHAT, id, "member", { name: `u${id}` }, NOW);
    await recordChannelSighting(ctx, CHAT, 111, "member", { name: "bot", isBot: true }, NOW);
    await recordChannelSighting(ctx, CHAT, 222, "member", { name: "ушёл" }, NOW);
    await recordChannelSighting(ctx, CHAT, 222, "left", {}, NOW);
    // чужой чат не записывается
    await recordChannelSighting(ctx, { id: -100999 }, 333, "member", {}, NOW);
    const list = await channelStrangers(ctx, NOW);
    expect(list.map((s) => [s.userId, s.name])).toEqual([
      [777, "u777"],
      [999, "u999"],
    ]);
  });

  it("срок доступа кончился — покупатель попадает в список; администратор — выпадает", async () => {
    const { ctx } = school();
    await recordChannelSighting(ctx, CHAT, 555, "member", {}, NOW);
    await recordChannelSighting(ctx, CHAT, 42, "member", {}, NOW);
    await recordChannelSighting(ctx, CHAT, 42, "administrator", {}, NOW);
    expect((await channelStrangers(ctx, NOW)).map((s) => s.userId)).toEqual([]);
    const later = new Date("2026-12-01T00:00:00Z");
    expect((await channelStrangers(ctx, later)).map((s) => s.userId)).toEqual([555]);
  });

  it("вступил по личной ссылке другим аккаунтом — тоже свой; доступ снят — посторонний", async () => {
    const { ctx, db } = school();
    (db.tables.app_settings as Array<Record<string, string>>).push({
      bot_id: T,
      key: inviteKey("item-1"),
      value: JSON.stringify({ member: 888 }),
    });
    await recordChannelSighting(ctx, CHAT, 888, "member", {}, NOW);
    expect(await channelStrangers(ctx, NOW)).toEqual([]);
    const row = (db.tables.app_settings as Array<Record<string, string>>).find(
      (r) => r.key === inviteKey("item-1"),
    )!;
    row.value = JSON.stringify({ member: 888, revoked: NOW.toISOString() });
    expect((await channelStrangers(ctx, NOW)).map((s) => s.userId)).toEqual([888]);
  });

  it("исключение: посторонний исключён и убран из списка; успевший купить — не тронут; отказ Telegram — остаётся", async () => {
    const { ctx } = school();
    await recordChannelSighting(ctx, CHAT, 999, "member", {}, NOW);
    await recordChannelSighting(ctx, CHAT, 555, "member", {}, NOW);
    const calls: number[] = [];
    const ok = {
      createInvite: async () => null,
      kick: async (_c: string, u: number) => (calls.push(u), true),
    };
    expect(await kickChannelStranger(ctx, course.channel!, 555, ok, NOW)).toEqual({
      kicked: false,
    });
    expect(calls).toEqual([]);
    const refuse = { createInvite: async () => null, kick: async () => false };
    expect(await kickChannelStranger(ctx, course.channel!, 999, refuse, NOW)).toEqual({
      kicked: false,
    });
    expect((await channelStrangers(ctx, NOW)).map((s) => s.userId)).toEqual([999]);
    expect(await kickChannelStranger(ctx, course.channel!, 999, ok, NOW)).toEqual({ kicked: true });
    expect(calls).toEqual([999]);
    expect(await channelStrangers(ctx, NOW)).toEqual([]);
  });

  it("чат потока: свой ученик и ученик другого потока, возврат — посторонние; исключение там же", async () => {
    const { ctx, db } = school();
    const chat = (db.tables.app_settings as Array<Record<string, string>>).find(
      (r) => r.key === courseKey(P),
    )!;
    chat.value = JSON.stringify({
      ...course,
      channel: undefined,
      cohorts: [
        {
          id: "c1000000-0000-4000-8000-000000000001",
          title: "Октябрь",
          start: "2026-10-05T10:00",
          enrollUntil: "2026-10-04",
          chat: "-1007770001",
        },
        {
          id: "c2000000-0000-4000-8000-000000000002",
          title: "Ноябрь",
          start: "2026-11-05T10:00",
          enrollUntil: "2026-11-04",
          chat: "-1008880001",
        },
      ],
    });
    (db.tables.order_items as Array<Record<string, unknown>>).push({
      id: "item-3",
      order_id: 9,
      product_id: P,
      product_variant_id: V,
      name_snapshot: "К",
    });
    (db.tables.orders as Array<Record<string, unknown>>).push({
      id: 9,
      status: "delivered",
      platform: "telegram",
      telegram_id: 666,
      created_at: "2026-11-01T00:00:00Z",
    });
    for (const id of [555, 666, 777, 999])
      await recordChannelSighting(ctx, { id: -1007770001 }, id, "member", {}, NOW);
    expect((await channelStrangers(ctx, NOW)).map((s) => s.userId)).toEqual([666, 777, 999]);
    const kick = { createInvite: async () => null, kick: async () => true };
    expect(await kickChannelStranger(ctx, "-1007770001", 999, kick, NOW)).toEqual({ kicked: true });
    expect(await kickChannelStranger(ctx, "-1007770001", 555, kick, NOW)).toEqual({
      kicked: false,
    });
    expect((await channelStrangers(ctx, NOW)).map((s) => s.userId)).toEqual([666, 777]);
  });
});
