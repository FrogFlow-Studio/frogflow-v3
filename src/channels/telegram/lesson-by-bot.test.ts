import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, parseCourse, type Course } from "@/core/courses/course";
import { COURSE_MARKER_URL } from "@/core/courses/marker";
import { lessonFromMessage } from "@/core/courses/lesson-by-bot";
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
    expect(said().at(-1)!.text).toBe("✅ Урок 2 «1.2 Материалы» добавлен в курс «Ресницы с нуля».");
  });

  it("без подписи — «Урок N»; та же ссылка второй раз не добавляется", async () => {
    const { ctx, api, lessons, said } = shop();
    await handleTelegramUpdate(ctx, api, msg(SELLER, "https://youtu.be/two", 1));
    await handleTelegramUpdate(ctx, api, msg(SELLER, "Ещё раз https://youtu.be/two", 2));
    expect(lessons().map((l) => l.title)).toEqual(["1.1 Введение", "Урок 2"]);
    expect(said().at(-1)!.text).toBe("Этот урок уже есть в курсе — второй раз не добавляю.");
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
    expect(said().at(-1)!.text).toBe("✅ Урок 2 «2.1 Пучки» добавлен в курс «Объём 2D».");
  });
});
