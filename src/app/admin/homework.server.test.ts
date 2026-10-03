import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "@/core/courses/course";

vi.mock("@/config/env", () => ({
  env: () => ({ SECRETS_KEY: "test-secret", APP_URL: "https://www.frogflow.tech" }),
}));
vi.mock("@/core/orders/orders", async (orig) => ({
  ...(await orig<typeof import("@/core/orders/orders")>()),
  signedFileUrl: async (path: string) => `https://files/${path}`,
}));
const notified: string[] = [];
vi.mock("./admin.server", () => ({
  notifyCustomer: vi.fn(async (_ctx: unknown, _order: unknown, text: string) => {
    notified.push(text);
    return true;
  }),
}));

const { homeworkQueue, reviewAndNotify } = await import("./homework.server");
const { submitHomework } = await import("@/core/courses/homework.server");
const { coursePurchase } = await import("@/core/courses/run.server");

/** Проверка домашних заданий в админке: очередь с файлами и сообщение ученику. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const L1 = "00000000-0000-4000-8000-000000000001";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [{ id: L1, title: "Кисти", text: "т", files: [], link: null, homework: "Круг" }],
};

function ctxWith() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: P, name_snapshot: "Аквагрим" }];
  db.tables.orders = [
    { id: 5, status: "delivered", platform: "telegram", telegram_id: 7, display_name: "Мария" },
  ];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  return {
    tenant: {
      id: T,
      modules: { courses: true },
      settings: { slug: "school", default_locale: "ru" },
    },
    db,
    appUrl: "https://www.frogflow.tech",
  } as unknown as TenantContext;
}

describe("домашние задания в админке", () => {
  it("очередь: работа с файлом, файл — подписанной ссылкой, картинка отмечена", async () => {
    const ctx = ctxWith();
    const p = (await coursePurchase(ctx, ITEM))!;
    await submitHomework(ctx, p, L1, {
      text: "готово",
      files: [{ path: `${T}/hw/${ITEM}/a.jpg`, name: "круг.jpg", mime: "image/jpeg" }],
    });
    const [row] = await homeworkQueue(ctx);
    expect(row).toMatchObject({ student: "Мария", status: "submitted", lessonTitle: "Кисти" });
    expect(row!.attempts[0]!.files).toEqual([
      { name: "круг.jpg", url: `https://files/${T}/hw/${ITEM}/a.jpg`, image: true },
    ]);
  });

  it("очередь: голосовое и видео помечены — страница покажет плеер, а не ссылку «скачать»", async () => {
    const ctx = ctxWith();
    const p = (await coursePurchase(ctx, ITEM))!;
    await submitHomework(ctx, p, L1, {
      text: "",
      files: [
        { path: `${T}/hw/${ITEM}/v.ogg`, name: "voice.ogg", mime: "audio/ogg" },
        { path: `${T}/hw/${ITEM}/k.mp4`, name: "video_note.mp4", mime: "video/mp4" },
        { path: `${T}/hw/${ITEM}/d.pdf`, name: "работа.pdf", mime: "application/pdf" },
      ],
    });
    const [row] = await homeworkQueue(ctx);
    expect(row!.attempts[0]!.files.map((f) => [f.name, f.media ?? null, f.image])).toEqual([
      ["voice.ogg", "audio", false],
      ["video_note.mp4", "video", false],
      ["работа.pdf", null, false],
    ]);
  });

  it("принять — ученику сообщение с отзывом и ссылкой на курс", async () => {
    const ctx = ctxWith();
    const p = (await coursePurchase(ctx, ITEM))!;
    const s = await submitHomework(ctx, p, L1, { text: "готово", files: [] });
    const rev = s.ok ? s.homework.rev : -1;
    const r = await reviewAndNotify(ctx, {
      orderItemId: ITEM,
      lessonId: L1,
      rev,
      status: "accepted",
      text: "Отличные линии",
      by: "anastasia",
    });
    expect(r).toEqual({ status: "accepted", notified: true });
    expect(notified.at(-1)).toContain("Домашнее задание принято: Аквагрим, урок 1.");
    expect(notified.at(-1)).toContain("Отличные линии");
    expect(notified.at(-1)).toMatch(/https:\/\/www\.frogflow\.tech\/s\/school\/course\//);
  });

  it("вернуть без комментария — отказ продавцу", async () => {
    const ctx = ctxWith();
    const p = (await coursePurchase(ctx, ITEM))!;
    const s = await submitHomework(ctx, p, L1, { text: "готово", files: [] });
    await expect(
      reviewAndNotify(ctx, {
        orderItemId: ITEM,
        lessonId: L1,
        rev: s.ok ? s.homework.rev : -1,
        status: "revise",
        text: " ",
        by: "a",
      }),
    ).rejects.toMatchObject({ key: "err.homework.emptyRevise" });
  });
});
