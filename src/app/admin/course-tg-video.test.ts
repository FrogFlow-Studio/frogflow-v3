import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, parseCourse, type Course } from "@/core/courses/course";
import { COURSE_MARKER_URL } from "@/core/courses/marker";

/**
 * Видео из бота в карточке курса (03.11.2026, просьба Якова): видно, к какому
 * уроку привязано, «Прислать мне в Telegram» и «Убрать» без похода в базу.
 */
const calls: Array<[string, Record<string, unknown>]> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => ({}) }));
vi.mock("@/channels/telegram/notify", () => ({
  adminTelegramApi: () => ({
    call: async (m: string, p: Record<string, unknown>) => {
      calls.push([m, p]);
      return { ok: true, result: {} };
    },
  }),
}));
vi.mock("@/core/notify/recipients", () => ({ adminRecipients: async () => ["-100777"] }));
const { removeLessonTgVideo } = await import("@/core/courses/lesson-by-bot.server");
const { sendLessonTgVideo } = await import("./course-tg-video.server");

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    {
      id: L1,
      title: "Модуль 1 · 1.1. Знакомство",
      text: "",
      files: [],
      link: "https://youtu.be/one",
      tgVideos: ["VID-AAAA1111", "VID-BBBB2222"],
    },
    {
      id: L2,
      title: "1.2. Материалы",
      text: "",
      files: [],
      link: null,
      tgVideos: ["VID-CCCC3333"],
    },
  ],
};

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

function shop() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [
    { id: P, bot_id: T, name: "Курс", fulfillment_kind: "digital", file_url: COURSE_MARKER_URL },
  ];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  const ctx = {
    tenant: { id: T, ownerTelegramId: "1580", modules: { courses: true }, settings: {} },
    db,
    appUrl: "https://app.test",
  } as unknown as TenantContext;
  const lessons = () =>
    parseCourse(
      (db.tables.app_settings as Array<{ key: string; value: string }>).find(
        (r) => r.key === courseKey(P),
      )!.value,
    ).lessons;
  return { ctx, lessons };
}

describe("видео из бота в карточке курса", () => {
  it("«Убрать» по id урока и file_id: остальное в уроке остаётся", async () => {
    const { ctx, lessons } = shop();
    expect(await removeLessonTgVideo(ctx, P, L1, "VID-AAAA1111")).toBe("removed");
    expect(lessons()[0]).toMatchObject({
      link: "https://youtu.be/one",
      tgVideos: ["VID-BBBB2222"],
    });
    // Повтор (двойной клик) — видео уже нет, ничего не трогаем.
    expect(await removeLessonTgVideo(ctx, P, L1, "VID-AAAA1111")).toBe("gone");
    expect(lessons()[0]!.tgVideos).toEqual(["VID-BBBB2222"]);
    // Чужой урок — не находится.
    expect(await removeLessonTgVideo(ctx, P, L1, "VID-CCCC3333")).toBe("gone");
  });

  it("урок, где было только это видео, убирается целиком", async () => {
    const { ctx, lessons } = shop();
    expect(await removeLessonTgVideo(ctx, P, L2, "VID-CCCC3333")).toBe("lessonRemoved");
    expect(lessons().map((l) => l.id)).toEqual([L1]);
  });

  it("«Прислать мне в Telegram»: владельцу — само видео с подписью урока", async () => {
    const { ctx } = shop();
    calls.length = 0;
    expect(await sendLessonTgVideo(ctx, P, L1, "VID-BBBB2222", true)).toEqual({
      sent: 1,
      target: "you",
    });
    expect(calls).toEqual([
      [
        "sendVideo",
        {
          chat_id: "1580",
          video: "VID-BBBB2222",
          caption: "🎬 1. Модуль 1 · 1.1. Знакомство · 2",
          protect_content: true,
        },
      ],
    ]);
    // Сотрудник — в чат уведомлений магазина.
    calls.length = 0;
    expect(await sendLessonTgVideo(ctx, P, L2, "VID-CCCC3333", false)).toEqual({
      sent: 1,
      target: "chat",
    });
    expect(calls[0]![1].chat_id).toBe("-100777");
    // Видео уже нет — понятный отказ, не отправка.
    await expect(sendLessonTgVideo(ctx, P, L2, "VID-AAAA1111", true)).rejects.toThrow(
      "Этого видео в уроке уже нет",
    );
  });
});
