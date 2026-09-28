import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { announceNewLessons, type LessonAnnouncement } from "./announce.server";
import { courseKey, type Course } from "./course";
import { courseStudents } from "./progress.server";
import { parseRun, runKey, startRun } from "./run.server";

vi.mock("@/config/env", () => ({
  env: () => ({ SECRETS_KEY: "test-secret", APP_URL: "https://www.frogflow.tech" }),
}));

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const lid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY = 86_400_000;
const START = "2026-09-01T10:00:00.000Z";
const at = (days: number) => new Date(Date.parse(START) + days * DAY + 60_000);

const course: Course = {
  schedule: { mode: "drip", everyDays: 2 },
  lessons: [1, 2, 3].map((n) => ({
    id: lid(n),
    title: `Урок <${n}>`,
    text: "т",
    files: [],
    link: null,
  })),
};

function setup(opts: { platform?: string; status?: string; courses?: boolean } = {}) {
  const db = fakeDb();
  db.tables.order_items = [{ id: "item-1", order_id: 7, product_id: P }];
  db.tables.orders = [
    {
      id: 7,
      order_no: 107,
      display_no: null,
      display_name: "Анна",
      created_at: "2026-09-01T09:00:00Z",
      status: opts.status ?? "delivered",
      platform: opts.platform ?? "telegram",
      telegram_id: opts.platform && opts.platform !== "telegram" ? 0 : 555,
    },
  ];
  db.tables.app_settings = [
    { key: courseKey(P), value: JSON.stringify(course) },
    { key: runKey("item-1"), value: JSON.stringify({ startedAt: START, done: [], notified: 1 }) },
  ];
  const ctx = {
    tenant: { id: T, modules: { courses: opts.courses ?? true }, settings: { slug: "shop" } },
    db,
    appUrl: "https://www.frogflow.tech",
  } as unknown as TenantContext;
  const sent: LessonAnnouncement[] = [];
  const send = async (a: LessonAnnouncement) => (sent.push(a), true);
  const run = () =>
    parseRun(db.tables.app_settings!.find((r) => r.key === runKey("item-1"))!.value as string);
  return { ctx, db, sent, send, run };
}

describe("курс — сообщение о новом уроке", () => {
  it("открылся второй урок — одно сообщение со ссылкой, повторный прогон молчит", async () => {
    const { ctx, sent, send, run } = setup();
    expect(await announceNewLessons(ctx, send, at(1))).toEqual({ sent: 0, failed: 0, silent: 0 });
    expect(await announceNewLessons(ctx, send, at(2))).toEqual({ sent: 1, failed: 0, silent: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ telegramId: 555, lessonNo: 2, title: "Урок <2>" });
    expect(sent[0]!.url).toMatch(/^https:\/\/www\.frogflow\.tech\/s\/shop\/course\/item-1\?k=/);
    expect(run()!.notified).toBe(2);
    await announceNewLessons(ctx, send, at(3));
    expect(sent).toHaveLength(1);
  });

  it("два параллельных прогона крона — одно сообщение", async () => {
    const { ctx, sent, send } = setup();
    await Promise.all([announceNewLessons(ctx, send, at(2)), announceNewLessons(ctx, send, at(2))]);
    expect(sent).toHaveLength(1);
  });

  it("пропущенные дни — одно сообщение о последнем открытом уроке, не пачка", async () => {
    const { ctx, sent, send, run } = setup();
    await announceNewLessons(ctx, send, at(10));
    expect(sent.map((a) => a.lessonNo)).toEqual([3]);
    expect(run()!.notified).toBe(3);
  });

  it("Instagram/WhatsApp, невыданный заказ или модуль выключен — не пишем", async () => {
    const ig = setup({ platform: "instagram" });
    expect(await announceNewLessons(ig.ctx, ig.send, at(2))).toMatchObject({ silent: 1 });
    expect(ig.sent).toEqual([]);
    // Урок отмечен объявленным: не всплывёт, когда появится отправка в Direct.
    expect(ig.run()!.notified).toBe(2);

    const unpaid = setup({ status: "awaiting_payment" });
    await announceNewLessons(unpaid.ctx, unpaid.send, at(2));
    expect(unpaid.sent).toEqual([]);

    const off = setup({ courses: false });
    expect(await announceNewLessons(off.ctx, off.send, at(2))).toEqual({ skipped: "module off" });
  });

  it("начало прохождения: уроки первого дня считаются известными", async () => {
    const { ctx } = setup();
    const p = {
      orderItemId: "item-2",
      orderId: 7,
      telegramId: 700,
      boughtAt: "2026-09-01T00:00:00Z",
      variantId: null,
      productId: P,
      name: "Курс",
      course: { ...course, schedule: { mode: "all" as const } },
      run: null,
    };
    expect((await startRun(ctx, p, at(0))).notified).toBe(3);
  });
});

describe("курс — прогресс учеников для продавца", () => {
  it("покупатель, открытые и пройденные уроки; неначатый курс и неоплаченный заказ", async () => {
    const { ctx, db } = setup();
    db.tables.app_settings!.find((r) => r.key === runKey("item-1"))!.value = JSON.stringify({
      startedAt: START,
      done: [lid(1), "удалённый-урок"],
    });
    db.tables.order_items!.push(
      { id: "item-2", order_id: 8, product_id: P },
      { id: "item-3", order_id: 9, product_id: P },
    );
    db.tables.orders!.push(
      {
        id: 8,
        order_no: 108,
        display_name: null,
        created_at: "2026-09-02T09:00:00Z",
        status: "delivered",
      },
      {
        id: 9,
        order_no: 109,
        display_name: "Б",
        created_at: "2026-09-03T09:00:00Z",
        status: "awaiting_payment",
      },
    );
    const r = await courseStudents(ctx, P, at(2));
    expect(r.total).toBe(3);
    expect(r.students).toMatchObject([
      {
        orderNo: 108,
        buyer: null,
        boughtAt: "2026-09-02T09:00:00Z",
        startedAt: null,
        open: 0,
        done: 0,
      },
      {
        orderNo: 107,
        buyer: "Анна",
        boughtAt: "2026-09-01T09:00:00Z",
        startedAt: START,
        open: 2,
        done: 1,
        behind: false,
        inChannel: false,
      },
    ]);
  });
});
