import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { hwKey } from "./homework";

vi.mock("@/config/env", () => ({ env: () => ({ SECRETS_KEY: "s", APP_URL: "https://a.test" }) }));
const { courseReminders } = await import("./reminders.server");
const { runKey } = await import("./run.server");

/** Напоминания курса: до старта, несданное ДЗ, конец доступа — по одному разу. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V = "bbbbbbbb-0000-4000-8000-000000000001";
const L1 = "00000000-0000-4000-8000-000000000001";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [{ id: L1, title: "Кисти", text: "т", files: [], link: null, homework: "Круг" }],
  cohorts: [
    {
      id: "cccccccc-0000-4000-8000-000000000001",
      title: "Октябрь",
      start: "2026-10-15T10:00",
      enrollUntil: null,
    },
  ],
  tariffs: { [V]: { homework: true, channel: true, accessDays: 30 } },
  homeworkDays: 3,
  channel: "@school_club",
};

function school() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: "item-1", order_id: 7, product_id: P, product_variant_id: V, name_snapshot: "Аквагрим" },
  ];
  db.tables.orders = [
    {
      id: 7,
      status: "delivered",
      platform: "telegram",
      telegram_id: 555,
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
        cohortId: "cccccccc-0000-4000-8000-000000000001",
      }),
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

describe("напоминания курса", () => {
  it("до старта: за 3 дня и за день — по одному сообщению", async () => {
    const { ctx } = school();
    const sent: Array<{ kind: string; days?: number }> = [];
    const send = async (x: { kind: string; days?: number }) => (sent.push(x), true);
    for (const at of [
      "2026-10-11T08:00:00Z",
      "2026-10-12T08:00:00Z",
      "2026-10-12T09:00:00Z",
      "2026-10-14T08:00:00Z",
    ])
      await courseReminders(ctx, send, null, new Date(at));
    expect(sent.map((s) => [s.kind, s.days])).toEqual([
      ["pre", 3],
      ["pre", 1],
    ]);
  });

  it("задание не сдано через 3 дня после открытия — одно напоминание; сдано — ни одного", async () => {
    const { ctx } = school();
    const sent: string[] = [];
    const send = async (x: { kind: string }) => (sent.push(x.kind), true);
    await courseReminders(ctx, send, null, new Date("2026-10-18T08:00:00Z"));
    await courseReminders(ctx, send, null, new Date("2026-10-18T09:00:00Z"));
    expect(sent.filter((k) => k === "homework")).toHaveLength(1);

    const other = school();
    (other.db.tables.app_settings as Array<Record<string, string>>).push({
      bot_id: T,
      key: hwKey("item-1", L1),
      value: JSON.stringify({
        rev: 1,
        orderItemId: "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee",
        lessonId: L1,
        productId: P,
        course: "А",
        lessonNo: 1,
        lessonTitle: "К",
        student: "М",
        status: "submitted",
        attempts: [],
        feedback: null,
        updatedAt: "2026-10-16T00:00:00Z",
      }),
    });
    const sent2: string[] = [];
    await courseReminders(
      other.ctx,
      async (x) => (sent2.push(x.kind), true),
      null,
      new Date("2026-10-18T08:00:00Z"),
    );
    expect(sent2).not.toContain("homework");
  });

  it("доступ по тарифу кончился — исключение из канала один раз", async () => {
    const { ctx } = school();
    const kicks: number[] = [];
    const access = {
      createInvite: async () => null,
      kick: async (_c: string, u: number) => (kicks.push(u), true),
    };
    const send = async () => true;
    const r = await courseReminders(ctx, send, access, new Date("2026-11-15T08:00:00Z"));
    await courseReminders(ctx, send, access, new Date("2026-11-15T09:00:00Z"));
    expect(r).toMatchObject({ accessEnded: 1 });
    expect(kicks).toEqual([555]);
  });

  it("доступ продлён вручную — крон окончания срока никого не исключает", async () => {
    const { ctx, db } = school();
    const row = (db.tables.app_settings as Array<Record<string, string>>).find((r) =>
      r.key?.startsWith("course_run_"),
    )!;
    row.value = JSON.stringify({ ...JSON.parse(row.value!), until: "2026-11-20T20:59:59.999Z" });
    const kicks: number[] = [];
    const access = {
      createInvite: async () => null,
      kick: async (_c: string, u: number) => (kicks.push(u), true),
    };
    const r = await courseReminders(
      ctx,
      async () => true,
      access,
      new Date("2026-11-15T08:00:00Z"),
    );
    expect(r).toMatchObject({ accessEnded: 0 });
    expect(kicks).toEqual([]);
    const later = await courseReminders(
      ctx,
      async () => true,
      access,
      new Date("2026-11-21T08:00:00Z"),
    );
    expect(later).toMatchObject({ accessEnded: 1 });
  });
});

describe("напоминания курса: два крона одновременно", () => {
  it("до старта, несданное задание и конец доступа — по одному разу на два прогона", async () => {
    const steps = [
      { at: "2026-10-12T08:00:00Z", kind: "pre" },
      { at: "2026-10-18T08:00:00Z", kind: "homework" },
    ];
    for (const { at, kind } of steps) {
      const { ctx } = school();
      const sent: string[] = [];
      const send = async (x: { kind: string }) => (sent.push(x.kind), true);
      await Promise.all([
        courseReminders(ctx, send, null, new Date(at)),
        courseReminders(ctx, send, null, new Date(at)),
      ]);
      expect(
        sent.filter((k) => k === kind),
        kind,
      ).toHaveLength(1);
    }
    const { ctx } = school();
    const kicks: number[] = [];
    const access = {
      createInvite: async () => null,
      kick: async (_c: string, u: number) => (kicks.push(u), true),
    };
    await Promise.all([
      courseReminders(ctx, async () => true, access, new Date("2026-11-15T08:00:00Z")),
      courseReminders(ctx, async () => true, access, new Date("2026-11-15T08:00:00Z")),
    ]);
    expect(kicks).toEqual([555]);
  });
});

describe("сегмент рассылки «ученики курса»", () => {
  it("все, не сдавшие ДЗ, отстающие, прошедшие; поток и чужой курс отсекаются", async () => {
    const { courseSegmentMembers } = await import("./segment.server");
    const { parseSegment } = await import("@/core/broadcasts/segments");
    const { ctx } = school();
    const at = new Date("2026-10-16T08:00:00Z");
    expect([...(await courseSegmentMembers(ctx, P, "all", null, at))]).toEqual([555]);
    expect([...(await courseSegmentMembers(ctx, P, "homework", null, at))]).toEqual([555]);
    expect([...(await courseSegmentMembers(ctx, P, "completed", null, at))]).toEqual([]);
    expect([
      ...(await courseSegmentMembers(ctx, P, "all", "cccccccc-0000-4000-8000-000000000009", at)),
    ]).toEqual([]);
    expect([
      ...(await courseSegmentMembers(ctx, "aaaaaaaa-bbbb-cccc-dddd-000000000000", "all", null, at)),
    ]).toEqual([]);
    expect(parseSegment({ kind: "course", productId: P, who: "homework" })).toEqual({
      kind: "course",
      productId: P,
      who: "homework",
      cohortId: null,
    });
    expect(parseSegment({ kind: "course", productId: P, who: "всем" })).toBeNull();
  });
});

describe("просьба оценить курс (А28)", () => {
  const CODE = "ABCDEFGH2345";
  /** Школа с выданным сертификатом; `at` — когда он выдан. */
  function graduate(at: string, modules: Record<string, boolean> = { review_request: true }) {
    const s = school();
    (s.ctx.tenant as unknown as { modules: Record<string, boolean> }).modules = {
      courses: true,
      ...modules,
    };
    (s.db.tables.app_settings as Array<Record<string, string>>).push(
      { bot_id: T, key: "course_certi_item-1", value: CODE },
      {
        bot_id: T,
        key: `course_cert_${CODE}`,
        value: JSON.stringify({
          code: CODE,
          no: 1,
          orderItemId: "item-1",
          student: "М",
          course: "Аквагрим",
          issuedAt: at,
        }),
      },
    );
    return s;
  }
  const NOW = new Date("2026-10-20T08:00:00Z");

  it("окончил курс — одна просьба с товаром курса, повтор молчит", async () => {
    const { ctx, db } = graduate("2026-10-19T10:00:00Z");
    const sent: Array<Record<string, unknown>> = [];
    const send = async (x: { kind: string }) => (sent.push(x), true);
    await courseReminders(ctx, send, null, NOW);
    await courseReminders(ctx, send, null, new Date(NOW.getTime() + 3_600_000));
    expect(sent.filter((x) => x.kind === "review")).toEqual([
      { kind: "review", telegramId: 555, course: "Аквагрим", productId: P },
    ]);
    const run = (db.tables.app_settings as Array<Record<string, string>>).find((r) =>
      r.key?.startsWith("course_run_"),
    );
    expect(JSON.parse(run!.value!).reviewAsked).toBe(NOW.toISOString());
  });

  it("два крона одновременно — одно сообщение", async () => {
    const { ctx } = graduate("2026-10-19T10:00:00Z");
    const sent: string[] = [];
    const send = async (x: { kind: string }) => (sent.push(x.kind), true);
    await Promise.all([
      courseReminders(ctx, send, null, NOW),
      courseReminders(ctx, send, null, NOW),
    ]);
    expect(sent.filter((k) => k === "review")).toHaveLength(1);
  });

  it("сертификата нет, выдан давно или модуль отзывов выключен — тишина", async () => {
    const kinds = async ({ ctx }: { ctx: TenantContext }) => {
      const sent: string[] = [];
      await courseReminders(ctx, async (x) => (sent.push(x.kind), true), null, NOW);
      return sent;
    };
    expect(await kinds(school())).not.toContain("review");
    expect(await kinds(graduate("2026-10-01T10:00:00Z"))).not.toContain("review");
    expect(await kinds(graduate("2026-10-19T10:00:00Z", { review_request: false }))).not.toContain(
      "review",
    );
  });
});
