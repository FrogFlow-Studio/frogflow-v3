import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import {
  courseChannelInvite,
  courseChatInvite,
  recordChannelJoin,
  revokeCourseChannels,
} from "./channel.server";
import type { Course } from "./course";
import { courseProblem, parseCourse } from "./course";
import { runKey, type CoursePurchase } from "./run.server";

/** Чат потока: у каждого потока своя группа, ссылка и исключение — как у канала. */
const T = "11111111-2222-3333-4444-555555555555";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const CHAT_A = "-1001111111111";
const CHAT_B = "-1002222222222";
const NOW = new Date("2026-10-10T10:00:00Z");

const course: Course = {
  schedule: { mode: "all" },
  lessons: [],
  channel: "@school_club",
  cohorts: [
    { id: A, title: "Октябрь", start: "2026-10-05T10:00", enrollUntil: null, chat: CHAT_A },
    { id: B, title: "Ноябрь", start: "2026-11-05T10:00", enrollUntil: null, chat: CHAT_B },
  ],
};
const run = { startedAt: "2026-10-05T10:00:00Z", done: [], cohortId: A };
const p: CoursePurchase = {
  orderItemId: ITEM,
  orderId: 5,
  telegramId: 42,
  boughtAt: "2026-10-01T00:00:00Z",
  variantId: null,
  productId: "p",
  name: "Аквагрим",
  course,
  run,
};

function school() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.orders = [
    { id: 5, platform: "web", telegram_id: -1, created_at: "2026-10-01T00:00:00Z" },
  ];
  db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: "p", product_variant_id: null }];
  db.tables.app_settings = [
    { bot_id: T, key: "course_p", value: JSON.stringify(course) },
    { bot_id: T, key: runKey(ITEM), value: JSON.stringify(run) },
  ];
  return {
    tenant: { id: T, modules: { courses: true } },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

function access(inside: Set<string>) {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    port: {
      createInvite: async (chat: string) => `https://t.me/+${chat.replace(/\W/g, "")}_${++n}`,
      isMember: async (c: string, u: number) => inside.has(`${c}:${u}`),
      kick: async (c: string, u: number) => (calls.push(`kick:${c}:${u}`), true),
      revokeInvite: async (c: string) => void calls.push(`revoke:${c}`),
    },
  };
}

describe("чат потока", () => {
  it("ссылка ведёт в чат потока ученика, не в канал и не в чат другого потока", async () => {
    const ctx = school();
    const seen: string[] = [];
    const port = {
      createInvite: async (chat: string) => (seen.push(chat), `https://t.me/+${seen.length}`),
    };
    expect(await courseChatInvite(ctx, p, port, NOW)).toEqual({
      ok: true,
      link: "https://t.me/+1",
    });
    expect(await courseChannelInvite(ctx, p, port, NOW)).toEqual({
      ok: true,
      link: "https://t.me/+2",
    });
    expect(seen).toEqual([CHAT_A, "@school_club"]);
  });

  it("у потока нет чата — ссылки нет", async () => {
    const ctx = school();
    const noChat: CoursePurchase = {
      ...p,
      course: { ...course, cohorts: course.cohorts!.map((c) => ({ ...c, chat: null })) },
    };
    expect(await courseChatInvite(ctx, noChat, { createInvite: async () => "x" }, NOW)).toEqual({
      ok: false,
      reason: "noChannel",
    });
  });

  it("вступил по ссылке в чат — запомнено отдельно от канала; вторая ссылка не нужна, пока он внутри", async () => {
    const ctx = school();
    const inside = new Set<string>();
    const { port } = access(inside);
    const chat = await courseChatInvite(ctx, p, port, NOW);
    const channel = await courseChannelInvite(ctx, p, port, NOW);
    if (!chat.ok || !channel.ok) throw new Error("нет ссылок");
    expect(await recordChannelJoin(ctx, chat.link, 777)).toBe(true);
    inside.add(`${CHAT_A}:777`);
    expect(await courseChatInvite(ctx, p, port, NOW)).toEqual({
      ok: false,
      reason: "alreadyMember",
    });
    // Канал по-прежнему выдаёт свою свежую ссылку: вступление в чат его не трогает.
    expect(await courseChannelInvite(ctx, p, port, NOW)).toEqual({ ok: true, link: channel.link });
  });

  it("возврат: исключают и из канала, и из чата своего потока; чат другого потока не трогают; повтор — ничего", async () => {
    const ctx = school();
    const { port, calls } = access(new Set());
    const chat = await courseChatInvite(ctx, p, port, NOW);
    const channel = await courseChannelInvite(ctx, p, port, NOW);
    if (!chat.ok || !channel.ok) throw new Error("нет ссылок");
    await recordChannelJoin(ctx, chat.link, 777);
    await recordChannelJoin(ctx, channel.link, 777);
    expect(await revokeCourseChannels(ctx, 5, port, NOW)).toBe(2);
    expect(calls.filter((c) => c.startsWith("kick"))).toEqual([
      "kick:@school_club:777",
      `kick:${CHAT_A}:777`,
    ]);
    expect(calls.some((c) => c.includes(CHAT_B))).toBe(false);
    // Новых ссылок после возврата нет, повторный возврат никого не исключает.
    expect(await courseChatInvite(ctx, p, port, NOW)).toEqual({ ok: false, reason: "noChannel" });
    expect(await revokeCourseChannels(ctx, 5, port, NOW)).toBe(0);
  });

  it("чат потока читается и проверяется: мусор в id отбрасывается, плохой id не сохраняется", () => {
    const raw = JSON.stringify({
      schedule: { mode: "all" },
      lessons: [],
      cohorts: [
        { id: A, title: "a", start: "2026-10-05T10:00", chat: CHAT_A },
        { id: B, title: "b", start: "2026-11-05T10:00", chat: "не чат" },
      ],
    });
    expect(parseCourse(raw).cohorts?.map((c) => c.chat)).toEqual([CHAT_A, undefined]);
    const bad: Course = {
      schedule: { mode: "all" },
      lessons: [],
      cohorts: [
        { id: A, title: "a", start: "2026-10-05T10:00", enrollUntil: null, chat: "не чат" },
      ],
    };
    expect(courseProblem(T, bad)).toEqual({ kind: "badCohort", cohort: 1 });
    expect(courseProblem(T, course)).toBeNull();
  });
});
