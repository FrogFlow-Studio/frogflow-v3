import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, parseCourse, type Course } from "@/core/courses/course";
import { COURSE_MARKER_URL } from "@/core/courses/marker";
import {
  lessonFromMessage,
  lessonIndexByNumber,
  lessonNumberOf,
} from "@/core/courses/lesson-by-bot";
import type { TelegramApi } from "./api";

vi.mock("@/core/db/client.server", () => ({ serviceDb: () => ({}) }));
const { handleTelegramUpdate } = await import("./handle-update");

/** Урок сообщением боту (settings.delivery.lessons_by_bot): продавец шлёт ссылку — урок в курсе. */
const SELLER = 1580;
const BUYER = 77;
const T = "11111111-2222-3333-4444-555555555555";
const P1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const P2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const lesson1 = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "1.1 Введение",
  text: "",
  files: [],
  link: "https://youtu.be/one",
};
const course: Course = { schedule: { mode: "all" }, lessons: [lesson1] };

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

function shop(opts: { on?: boolean; courses?: number } = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const ids = [P1, P2].slice(0, opts.courses ?? 1);
  db.tables.products = ids.map((id, i) => ({
    id,
    bot_id: T,
    name: i === 0 ? "Ресницы с нуля" : "Объём 2D",
    fulfillment_kind: "digital",
    file_url: COURSE_MARKER_URL,
  }));
  db.tables.app_settings = ids.map((id) => ({
    bot_id: T,
    key: courseKey(id),
    value: JSON.stringify(course),
  }));
  db.tables.bot_users = [];
  const ctx = {
    tenant: {
      id: T,
      name: "Lash",
      status: "active",
      vertical: "courses",
      ownerTelegramId: String(SELLER),
      modules: { courses: true },
      settings: {
        default_locale: "ru",
        slug: "lash",
        ...(opts.on === false ? {} : { delivery: { lessons_by_bot: true } }),
      },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Bishkek",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
    fileUrl: (p: string) => `https://files.test/${p}`,
  } as unknown as TelegramApi;
  const lessons = (id = P1) =>
    parseCourse(
      (db.tables.app_settings as Array<{ key: string; value: string }>).find(
        (r) => r.key === courseKey(id),
      )!.value,
    ).lessons;
  const said = () =>
    calls.filter(([m]) => m === "sendMessage").map(([, p]) => p as Record<string, unknown>);
  return { ctx, api, lessons, said };
}

const video = (who: number, caption: string | undefined, fileId: string, n = 1) =>
  ({
    update_id: n,
    message: {
      message_id: n,
      date: 0,
      chat: { id: who, type: "private" },
      from: { id: who, is_bot: false, first_name: "X" },
      video: { file_id: fileId },
      ...(caption ? { caption } : {}),
    },
  }) as never;

/** Первый абзац ответа (дальше — где увидят ученицы и подсказка). */
const first = (m: Record<string, unknown>) => String(m.text).split("\n\n")[0];
type Kb = { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
const buttons = (m: Record<string, unknown>) =>
  (m.reply_markup as Kb).inline_keyboard.flat().map((b) => [b.text, b.callback_data]);
const press = (who: number, data: string, n = 50) =>
  ({
    update_id: n,
    callback_query: {
      id: `cq${n}`,
      from: { id: who, is_bot: false, first_name: "X" },
      data,
      message: { message_id: n, chat: { id: who } },
    },
  }) as never;

const msg = (who: number, text: string, n = 1) =>
  ({
    update_id: n,
    message: {
      message_id: n,
      date: 0,
      chat: { id: who, type: "private" },
      from: { id: who, is_bot: false, first_name: "X" },
      text,
    },
  }) as never;

describe("урок сообщением боту", () => {
  it("разбор: ссылка и подпись в любом порядке, без https — не урок", () => {
    expect(lessonFromMessage("1.2 Материалы https://youtu.be/x")).toEqual({
      title: "1.2 Материалы",
      link: "https://youtu.be/x",
    });
    expect(lessonFromMessage("https://youtu.be/x — 1.2 Материалы")).toEqual({
      title: "1.2 Материалы",
      link: "https://youtu.be/x",
    });
    expect(lessonFromMessage("https://youtu.be/x")).toEqual({
      title: "",
      link: "https://youtu.be/x",
    });
    expect(lessonFromMessage("http://site.kz/v Урок")).toBeNull();
    expect(lessonFromMessage("Здравствуйте")).toBeNull();
  });

  it("продавец прислал ссылку с подписью — урок в конце курса, ответ с номером", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, msg(SELLER, "1.2 Материалы https://youtu.be/two"));
    expect(lessons().map((l) => [l.title, l.link])).toEqual([
      ["1.1 Введение", "https://youtu.be/one"],
      ["1.2 Материалы", "https://youtu.be/two"],
    ]);
    expect(first(said().at(-1)!)).toBe("✅ Новый урок 2 «1.2 Материалы» в курсе «Ресницы с нуля».");
  });

  it("без подписи — «Урок N»; та же ссылка второй раз не добавляется", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, msg(SELLER, "https://youtu.be/two", 1));
    await handleTelegramUpdate(ctx, api, msg(SELLER, "Ещё раз https://youtu.be/two", 2));
    expect(lessons().map((l) => l.title)).toEqual(["1.1 Введение", "Урок 2"]);
    expect(said().at(-1)!.text).toBe("Это видео уже есть в курсе — второй раз не добавляю.");
  });

  it("покупатель прислал ссылку — курс не меняется", async () => {
    const { ctx, api, lessons } = shop();
    await handleTelegramUpdate(ctx, api, msg(BUYER, "Вот https://youtu.be/hack"));
    expect(lessons()).toHaveLength(1);
  });

  it("переключатель выключен (как у всех магазинов) — ссылка продавца не становится уроком", async () => {
    const { ctx, api, lessons } = shop({ on: false });
    await handleTelegramUpdate(ctx, api, msg(SELLER, "1.2 Материалы https://youtu.be/two"));
    expect(lessons()).toHaveLength(1);
  });

  it("несколько курсов — бот спрашивает кнопками, нажатие добавляет в выбранный", async () => {
    const { ctx, api, lessons, said } = shop({ courses: 2 });
    const text = "2.1 Пучки https://youtu.be/vol";
    await handleTelegramUpdate(ctx, api, msg(SELLER, text));
    const ask = said().at(-1)!;
    expect(ask.text).toBe("В какой курс добавить урок?");
    const kb = (ask.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
      .inline_keyboard;
    expect(kb.flat().map((b) => b.callback_data)).toEqual([`lbb:${P2}`, `lbb:${P1}`]);
    expect(lessons(P2)).toHaveLength(1);
    const press = {
      update_id: 5,
      callback_query: {
        id: "cq",
        from: { id: SELLER, is_bot: false, first_name: "X" },
        data: `lbb:${P2}`,
        message: { message_id: 9, chat: { id: SELLER }, reply_to_message: { text } },
      },
    } as never;
    await handleTelegramUpdate(ctx, api, press);
    expect(lessons(P2).map((l) => l.title)).toEqual(["1.1 Введение", "2.1 Пучки"]);
    expect(lessons(P1)).toHaveLength(1);
    expect(first(said().at(-1)!)).toBe("✅ Новый урок 2 «2.1 Пучки» в курсе «Объём 2D».");
  });

  it("видео файлом с подписью — урок с видео из Telegram; видео с той же подписью — в тот же урок", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.2 Материалы", "BAACAgIAAxkBAAIvid1", 1));
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.2 Материалы", "BAACAgIAAxkBAAIvid2", 2));
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.2 Материалы", "BAACAgIAAxkBAAIvid2", 3));
    const ls = lessons();
    expect(ls).toHaveLength(2);
    expect(ls[1]).toMatchObject({
      title: "1.2 Материалы",
      link: null,
      tgVideos: ["BAACAgIAAxkBAAIvid1", "BAACAgIAAxkBAAIvid2"],
    });
    expect(said().map(first)).toEqual([
      "✅ Новый урок 2 «1.2 Материалы» в курсе «Ресницы с нуля».",
      "✅ Видео добавлено в урок 2 «1.2 Материалы» (курс «Ресницы с нуля»).",
      "Это видео уже есть в курсе — второй раз не добавляю.",
    ]);
  });

  it("номер в подписи: «1.1» и «1.10» не путаются, просто «3» — только «Урок 3»", () => {
    expect(lessonNumberOf("1.1")).toBe("1.1");
    expect(lessonNumberOf("1.2. Материалы")).toBe("1.2");
    expect(lessonNumberOf("3) Коррекция")).toBe("3");
    expect(lessonNumberOf("Материалы")).toBeNull();
    expect(lessonNumberOf("2026 год")).toBeNull();
    const titles = [
      "Модуль 1 · 1.10. Итоги",
      "Модуль 1 · 1.1. Знакомство",
      "Модуль 3 · 3.1. Объём",
      "Урок 3",
    ];
    expect(lessonIndexByNumber(titles, "1.1")).toBe(1);
    expect(lessonIndexByNumber(titles, "1.10")).toBe(0);
    expect(lessonIndexByNumber(titles, "3")).toBe(3);
    expect(lessonIndexByNumber(titles, "3.2")).toBe(-1);
  });

  it("видео с подписью «1.1» — в существующий урок 1.1, нового урока нет; ответ объясняет, где смотреть", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, msg(SELLER, "1.2 Материалы https://youtu.be/two", 1));
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.1", "BAACAgIAAxkBAAIvidAAAA11", 2));
    const ls = lessons();
    expect(ls.map((l) => l.title)).toEqual(["1.1 Введение", "1.2 Материалы"]);
    expect(ls[0]).toMatchObject({
      link: "https://youtu.be/one",
      tgVideos: ["BAACAgIAAxkBAAIvidAAAA11"],
    });
    const reply = said().at(-1)!;
    expect(String(reply.text).split("\n\n")).toEqual([
      "✅ Видео добавлено в урок 1 «1.1 Введение» (курс «Ресницы с нуля»).",
      "Ученицы увидят его в боте: «🎓 Мои курсы» → урок 1. Видео придёт им прямо в чат, переслать его нельзя.",
      "Подсказка: в подписи пишите номер урока, например «1.1», — видео попадёт в этот урок. Подпись без номера — новый урок в конце курса.",
    ]);
    expect(buttons(reply)).toEqual([
      ["👁 Посмотреть урок", `lbv:${P1}:1`],
      ["🗑 Убрать это видео", `lbd:${P1}:1:0:idAAAA11`],
    ]);
  });

  it("несколько курсов, номер урока есть только в одном — бот не спрашивает курс", async () => {
    const { ctx, api, lessons, said } = shop({ courses: 2 });
    const db = ctx.db as unknown as {
      tables: { app_settings: Array<{ key: string; value: string }> };
    };
    db.tables.app_settings.find((r) => r.key === courseKey(P2))!.value = JSON.stringify({
      ...course,
      lessons: [{ ...lesson1, title: "2.1 Пучки" }],
    });
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.1", "BAACAgIAAxkBAAIvidBBBB22"));
    expect(lessons(P1)[0]!.tgVideos).toEqual(["BAACAgIAAxkBAAIvidBBBB22"]);
    expect(lessons(P2)[0]!.tgVideos).toBeUndefined();
    expect(said().map((m) => m.text)).not.toContain("В какой курс добавить урок?");
    expect(first(said().at(-1)!)).toBe(
      "✅ Видео добавлено в урок 1 «1.1 Введение» (курс «Ресницы с нуля»).",
    );
  });

  it("«Посмотреть урок» присылает продавцу видео урока и текст", async () => {
    const { ctx, api } = shop();
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.1", "BAACAgIAAxkBAAIvidCCCC33", 1));
    const calls = (api.call as ReturnType<typeof vi.fn>).mock.calls;
    const before = calls.length;
    await handleTelegramUpdate(ctx, api, press(SELLER, `lbv:${P1}:1`));
    const sent = calls.slice(before).filter(([m]) => m !== "answerCallbackQuery");
    expect(sent[0]).toEqual([
      "sendVideo",
      expect.objectContaining({
        chat_id: SELLER,
        video: "BAACAgIAAxkBAAIvidCCCC33",
        protect_content: true,
      }),
    ]);
    expect(sent[1]![0]).toBe("sendMessage");
    expect(sent[1]![1]).toMatchObject({ text: "📖 1. 1.1 Введение" });
  });

  it("«Убрать это видео»: из урока со ссылкой убирается видео, пустой урок — целиком; покупатель не может", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.1", "BAACAgIAAxkBAAIvidDDDD44", 1));
    await handleTelegramUpdate(ctx, api, video(SELLER, "Бонус", "BAACAgIAAxkBAAIvidEEEE55", 2));
    expect(lessons()).toHaveLength(2);
    await handleTelegramUpdate(ctx, api, press(BUYER, `lbd:${P1}:1:0:idDDDD44`, 3));
    expect(lessons()[0]!.tgVideos).toEqual(["BAACAgIAAxkBAAIvidDDDD44"]);
    await handleTelegramUpdate(ctx, api, press(SELLER, `lbd:${P1}:1:0:idDDDD44`, 4));
    expect(lessons()[0]).toMatchObject({ title: "1.1 Введение", link: "https://youtu.be/one" });
    expect(lessons()[0]!.tgVideos ?? []).toEqual([]);
    expect(said().at(-1)!.text).toBe("Видео убрано из урока 1.");
    await handleTelegramUpdate(ctx, api, press(SELLER, `lbd:${P1}:2:0:idEEEE55`, 5));
    expect(lessons().map((l) => l.title)).toEqual(["1.1 Введение"]);
    expect(said().at(-1)!.text).toBe("Урок 2 убран: в нём не осталось материалов.");
    // Повторное нажатие или уроки сдвинулись — чужое видео не трогаем.
    await handleTelegramUpdate(ctx, api, press(SELLER, `lbd:${P1}:1:0:idEEEE55`, 6));
    expect(said().at(-1)!.text).toBe("Этого видео в уроке уже нет.");
  });

  it("видео от покупателя — не урок", async () => {
    const { ctx, api, lessons } = shop();
    await handleTelegramUpdate(ctx, api, video(BUYER, "Моё", "BAACAgIAAxkBAAIvid9"));
    expect(lessons()).toHaveLength(1);
  });

  it("видео файлом с подписью — урок с видео из Telegram; видео с той же подписью — в тот же урок", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.2 Материалы", "BAACAgIAAxkBAAIvid1", 1));
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.2 Материалы", "BAACAgIAAxkBAAIvid2", 2));
    await handleTelegramUpdate(ctx, api, video(SELLER, "1.2 Материалы", "BAACAgIAAxkBAAIvid2", 3));
    const ls = lessons();
    expect(ls).toHaveLength(2);
    expect(ls[1]).toMatchObject({
      title: "1.2 Материалы",
      link: null,
      tgVideos: ["BAACAgIAAxkBAAIvid1", "BAACAgIAAxkBAAIvid2"],
    });
    const texts = said().map((m) => m.text);
    expect(texts).toEqual([
      "✅ Урок 2 «1.2 Материалы» добавлен в курс «Ресницы с нуля».",
      "✅ Ещё одно видео добавлено в урок 2 «1.2 Материалы» курса «Ресницы с нуля».",
      "Этот урок уже есть в курсе — второй раз не добавляю.",
    ]);
  });

  it("видео от покупателя — не урок", async () => {
    const { ctx, api, lessons } = shop();
    await handleTelegramUpdate(ctx, api, video(BUYER, "Моё", "BAACAgIAAxkBAAIvid9"));
    expect(lessons()).toHaveLength(1);
  });
});
