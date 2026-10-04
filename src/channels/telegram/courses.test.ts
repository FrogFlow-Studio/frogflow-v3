import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import { courseKey, type Course } from "@/core/courses/course";
import { hwKey, parseHomework } from "@/core/courses/homework";
import { inviteKey } from "@/core/courses/channel.server";
import type { TelegramApi } from "./api";

const uploads: string[] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { data: { path }, error: null };
        },
      }),
    },
  }),
}));
const notified: string[] = [];
vi.mock("./course-notify", () => ({
  notifyHomework: async (_ctx: unknown, hw: { lessonNo: number }) => {
    notified.push(`урок ${hw.lessonNo}`);
    return 1;
  },
}));

const { handleTelegramUpdate } = await import("./handle-update");

/**
 * Онлайн-школа в боте: «Мои курсы», сдача задания фото и альбомом прямо в
 * чат, личная ссылка в закрытый канал. Фейковая база и шпион вместо Bot API.
 */
const TG = 42;
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

const course: Course = {
  schedule: { mode: "drip", everyDays: 7 },
  lessons: [
    {
      id: id(1),
      title: "Кисти",
      text: "Урок",
      files: [],
      link: null,
      homework: "Нарисуйте круг",
      quiz: {
        pass: 100,
        questions: [
          { text: "Чем красят?", options: ["Кистью", "Ложкой"], correct: [0] },
          { text: "Что нужно?", options: ["Краски", "Мыло", "Вода"], correct: [0, 2] },
        ],
      },
    },
    {
      id: id(2),
      title: "Цвет",
      text: "Урок",
      files: [],
      link: "https://youtu.be/free",
      homework: "Смешайте",
      preview: true,
    },
  ],
  channel: "-1001234567890",
};

beforeAll(() => {
  setEnvForTests({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } })),
  );
});
afterAll(() => {
  setEnvForTests(undefined);
  vi.unstubAllGlobals();
});

function school(state: Record<string, unknown> = {}) {
  const db: FakeDb = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      state: { locale: "ru", ...state },
    },
  ];
  db.tables.orders = [
    {
      id: 5,
      order_no: 5,
      telegram_id: TG,
      platform: "telegram",
      status: "delivered",
      display_name: "Мария",
      user_key: userKey("telegram", TG),
      created_at: "2026-09-20T10:00:00Z",
      // «*, order_items(*)» у фейковой базы — готовым полем.
      order_items: [{ id: ITEM, order_id: 5, product_id: P, name_snapshot: "Аквагрим с нуля" }],
    },
  ];
  db.tables.order_items = [
    { id: ITEM, order_id: 5, product_id: P, name_snapshot: "Аквагрим с нуля", quantity: 1 },
  ];
  db.tables.app_settings = [
    { bot_id: T, key: courseKey(P), value: JSON.stringify(course) },
    {
      bot_id: T,
      key: `course_run_${ITEM}`,
      value: JSON.stringify({ startedAt: new Date().toISOString(), done: [] }),
    },
  ];
  const ctx = {
    tenant: {
      id: T,
      name: "Школа",
      status: "active",
      vertical: "courses",
      modules: { courses: true },
      settings: { default_locale: "ru", slug: "school" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  let invites = 0;
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      if (method === "getFile") return { ok: true, result: { file_path: "photos/1.jpg" } };
      if (method === "createChatInviteLink") {
        invites++;
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true, result: { invite_link: `https://t.me/+inv${invites}` } };
      }
      return { ok: true, result: {} };
    }),
    fileUrl: (p: string) => `https://files.test/${p}`,
  } as unknown as TelegramApi;
  return { ctx, db, api, calls, invites: () => invites };
}

const from = { id: TG, is_bot: false, first_name: "Мария" };
const chat = { id: TG, type: "private" };
const text = (t: string, n = 1) =>
  ({ update_id: n, message: { message_id: n, date: 0, chat, from, text: t } }) as never;
const photo = (n: number, extra: Record<string, unknown> = {}) =>
  ({
    update_id: n,
    message: {
      message_id: n,
      date: 0,
      chat,
      from,
      photo: [{ file_id: `f${n}`, file_size: 50_000 }],
      ...extra,
    },
  }) as never;
const press = (data: string, n = 1) =>
  ({
    update_id: n,
    callback_query: { id: `cq${n}`, from, data, message: { message_id: 9, date: 0, chat } },
  }) as never;

const messages = (calls: Array<[string, Record<string, unknown>]>) =>
  calls.filter(([m]) => m === "sendMessage").map(([, p]) => p);
const buttons = (p: Record<string, unknown> | undefined) =>
  (
    (
      p?.reply_markup as {
        inline_keyboard?: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
      }
    )?.inline_keyboard ?? []
  ).flat();
const state = (db: FakeDb) => db.tables.bot_users![0]!.state as Record<string, unknown>;
const homework = (db: FakeDb, lesson: string) =>
  parseHomework(
    (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === hwKey(ITEM, lesson),
    )?.value,
  );

describe("«Мои курсы» в боте", () => {
  it("кнопка меню показывает курс: прогресс, задание, ссылку на уроки, сдачу и канал", async () => {
    const { ctx, api, calls } = school();
    await handleTelegramUpdate(ctx, api, text("🎓 Мои курсы"));
    const card = messages(calls).at(-1)!;
    expect(card.text).toContain("Аквагрим с нуля");
    expect(card.text).toContain("Открыто уроков: 1 из 2");
    expect(card.text).toContain("Урок 1: ждёт вашего ответа");
    const b = buttons(card);
    expect(b.find((x) => x.url)?.url).toMatch(/^https:\/\/app\.test\/s\/school\/course\/.+\?k=/);
    expect(b.map((x) => x.callback_data).filter(Boolean)).toEqual([
      `lsl:${ITEM}`,
      `hw:${ITEM}:1`,
      `cinv:${ITEM}`,
    ]);
  });

  it("чужая покупка по подделанной кнопке — бот молчит и не ждёт ответа", async () => {
    const { ctx, db, api, calls } = school();
    (db.tables.orders![0] as Record<string, unknown>).telegram_id = 777;
    await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
    expect(messages(calls)).toEqual([]);
    expect(state(db).mode).toBeUndefined();
  });
});

describe("сдача задания в чат", () => {
  it("кнопка → задание; фото с подписью → работа на проверке, преподавателю уведомление", async () => {
    notified.length = 0;
    const { ctx, db, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
    expect(messages(calls).at(-1)!.text).toContain("Нарисуйте круг");
    expect(state(db)).toMatchObject({ mode: "awaiting_homework", hw_item: ITEM, hw_lesson: id(1) });

    await handleTelegramUpdate(ctx, api, photo(2, { caption: "Мой круг" }));
    const hw = homework(db, id(1));
    expect(hw).toMatchObject({ status: "submitted", student: "Мария" });
    expect(hw!.attempts).toHaveLength(1);
    expect(hw!.attempts[0]!.text).toBe("Мой круг");
    expect(hw!.attempts[0]!.files[0]!.path).toMatch(
      new RegExp(`^${T}/hw/${ITEM}/[0-9a-f]+\\.jpg$`),
    );
    expect(messages(calls).at(-1)!.text).toContain("Ответ отправлен преподавателю");
    expect(notified).toEqual(["урок 1"]);
    expect(state(db).mode).toBe("idle");
  });

  const serving = (bytes: Uint8Array) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes as BlobPart)),
    );
  const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0]);
  const mp4 = (size: number) => {
    const b = new Uint8Array(size);
    b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    return b;
  };
  const voice = (n: number, file_size: number) =>
    ({
      update_id: n,
      message: { message_id: n, date: 0, chat, from, voice: { file_id: `v${n}`, file_size } },
    }) as never;
  const note = (n: number, file_size: number) =>
    ({
      update_id: n,
      message: {
        message_id: n,
        date: 0,
        chat,
        from,
        video_note: { file_id: `n${n}`, file_size },
      },
    }) as never;

  it("голосовое сообщение — сдача с аудиофайлом, преподавателю уведомление", async () => {
    notified.length = 0;
    const { ctx, db, api, calls } = school();
    serving(OGG);
    try {
      await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
      await handleTelegramUpdate(ctx, api, voice(2, 40_000));
    } finally {
      serving(JPEG);
    }
    const hw = homework(db, id(1));
    expect(hw).toMatchObject({ status: "submitted" });
    expect(hw!.attempts[0]!.files[0]).toMatchObject({ mime: "audio/ogg", name: "voice.ogg" });
    expect(hw!.attempts[0]!.files[0]!.path).toMatch(/\.ogg$/);
    expect(messages(calls).at(-1)!.text).toContain("Ответ отправлен преподавателю");
    expect(notified).toEqual(["урок 1"]);
  });

  it("«кружок» крупнее 3 МБ принимается как видео, но не больше 20 МБ", async () => {
    const { ctx, db, api, calls } = school();
    serving(mp4(4 * 1024 * 1024));
    try {
      await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
      await handleTelegramUpdate(ctx, api, note(2, 4 * 1024 * 1024));
      expect(homework(db, id(1))!.attempts[0]!.files[0]).toMatchObject({ mime: "video/mp4" });
      // Слишком большое — отказ по размеру из сообщения, файл даже не скачивается.
      const other = school();
      await handleTelegramUpdate(other.ctx, other.api, press(`hw:${ITEM}:1`));
      await handleTelegramUpdate(other.ctx, other.api, voice(3, 21 * 1024 * 1024));
      expect(homework(other.db, id(1))).toBeNull();
      expect(messages(other.calls).at(-1)!.text).toContain("20 МБ");
    } finally {
      serving(JPEG);
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it("поддельный тип: текстовый файл под видом голосового — «не подходит»", async () => {
    const { ctx, db, api, calls } = school();
    serving(new TextEncoder().encode("просто текст, не звук"));
    try {
      await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
      await handleTelegramUpdate(ctx, api, voice(2, 100));
    } finally {
      serving(JPEG);
    }
    expect(homework(db, id(1))).toBeNull();
    expect(messages(calls).at(-1)!.text).toContain("не подходит");
  });

  it("альбом из трёх фото — одна сдача с тремя файлами и одно уведомление", async () => {
    notified.length = 0;
    const { ctx, db, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
    for (const n of [2, 3, 4])
      await handleTelegramUpdate(ctx, api, photo(n, { media_group_id: "album-1" }));
    const hw = homework(db, id(1));
    expect(hw!.attempts).toHaveLength(1);
    expect(hw!.attempts[0]!.files).toHaveLength(3);
    expect(notified).toEqual(["урок 1"]);
    expect(messages(calls).filter((m) => String(m.text).includes("Ответ отправлен"))).toHaveLength(
      1,
    );
  });

  it("фото без ожидания ответа — не домашнее задание", async () => {
    const { ctx, db, api } = school();
    await handleTelegramUpdate(ctx, api, photo(2));
    expect(homework(db, id(1))).toBeNull();
  });

  it("кнопка меню выводит из ожидания ответа — следующее фото уже не ДЗ", async () => {
    const { ctx, db, api } = school();
    await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:1`));
    await handleTelegramUpdate(ctx, api, text("🛒 Корзина", 2));
    expect(state(db).mode).toBe("idle");
    await handleTelegramUpdate(ctx, api, photo(3));
    expect(homework(db, id(1))).toBeNull();
  });

  it("закрытый по расписанию урок сдать нельзя", async () => {
    const { ctx, db, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`hw:${ITEM}:2`));
    expect(messages(calls).at(-1)!.text).toBe("Этот урок ещё не открыт.");
    expect(state(db).mode).toBeUndefined();
  });
});

describe("ссылка в закрытый канал", () => {
  it("два нажатия подряд — одна ссылка на одного человека; повтор отдаёт её же", async () => {
    const { ctx, db, api, calls, invites } = school();
    await Promise.all([
      handleTelegramUpdate(ctx, api, press(`cinv:${ITEM}`, 1)),
      handleTelegramUpdate(ctx, api, press(`cinv:${ITEM}`, 2)),
    ]);
    expect(invites()).toBe(1);
    const req = calls.find(([m]) => m === "createChatInviteLink")![1];
    expect(req).toMatchObject({ chat_id: "-1001234567890", member_limit: 1 });
    await handleTelegramUpdate(ctx, api, press(`cinv:${ITEM}`, 3));
    expect(invites()).toBe(1);
    const links = messages(calls).flatMap((m) => buttons(m).flatMap((b) => (b.url ? [b.url] : [])));
    expect(links).toContain("https://t.me/+inv1");
    expect(links.every((l) => l === "https://t.me/+inv1")).toBe(true);
    const rec = (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === inviteKey(ITEM),
    );
    expect(JSON.parse(rec!.value)).toMatchObject({ link: "https://t.me/+inv1" });
  });
});

describe("урок в чате", () => {
  it("«Уроки в чате» — список открытых; урок — текст и кнопка сдачи; закрытый — нельзя", async () => {
    const { ctx, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`lsl:${ITEM}`));
    expect(buttons(messages(calls).at(-1)).map((x) => x.callback_data)).toEqual([`lsn:${ITEM}:1`]);
    await handleTelegramUpdate(ctx, api, press(`lsn:${ITEM}:1`, 2));
    const lesson = messages(calls).at(-1)!;
    expect(String(lesson.text)).toContain("1. Кисти");
    expect(String(lesson.text)).toContain("Нарисуйте круг");
    expect(buttons(lesson).map((x) => x.callback_data)).toContain(`hw:${ITEM}:1`);
    await handleTelegramUpdate(ctx, api, press(`lsn:${ITEM}:2`, 3));
    expect(messages(calls).at(-1)!.text).toBe("Этот урок ещё не открыт.");
  });
});

describe("открытый урок до покупки", () => {
  it("кнопка с карточки отдаёт открытый урок без задания; закрытый — «не открыт»", async () => {
    const { ctx, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`opl:${P}:2`));
    const lesson = messages(calls).at(-1)!;
    expect(String(lesson.text)).toContain("2. Цвет");
    expect(String(lesson.text)).not.toContain("Смешайте");
    expect(buttons(lesson).map((x) => x.url)).toEqual(["https://youtu.be/free"]);
    await handleTelegramUpdate(ctx, api, press(`opl:${P}:1`, 2));
    expect(messages(calls).at(-1)!.text).toBe("Этот урок ещё не открыт.");
  });
});

describe("тест к уроку в боте", () => {
  const quizRec = (db: FakeDb) =>
    (db.tables.app_settings as Array<{ key: string; value: string }>).find((r) =>
      r.key.startsWith("quiz_"),
    );

  it("вопрос за вопросом: один верный, несколько верных, итог и отметка урока", async () => {
    const { ctx, db, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`lsn:${ITEM}:1`));
    expect(buttons(messages(calls).at(-1)).map((x) => x.callback_data)).toContain(`qz:${ITEM}:1`);
    await handleTelegramUpdate(ctx, api, press(`qz:${ITEM}:1`, 2));
    const q1 = messages(calls).at(-1)!;
    expect(String(q1.text)).toContain("Вопрос 1 из 2");
    // Верные ответы в кнопках не светятся: только текст вариантов.
    expect(JSON.stringify(q1)).not.toContain("correct");
    await handleTelegramUpdate(ctx, api, press("qa:0:0", 3));
    const q2 = messages(calls).at(-1)!;
    expect(String(q2.text)).toContain("Вопрос 2 из 2");
    expect(buttons(q2).map((x) => x.callback_data)).toEqual(["qa:1:0", "qa:1:1", "qa:1:2", "qd:1"]);
    // Нажатие на вопрос, который уже пройден, ничего не меняет.
    await handleTelegramUpdate(ctx, api, press("qa:0:1", 4));
    expect((state(db).qz as { q: number }).q).toBe(1);
    await handleTelegramUpdate(ctx, api, press("qa:1:0", 5));
    await handleTelegramUpdate(ctx, api, press("qa:1:2", 6));
    expect(calls.filter(([m]) => m === "editMessageReplyMarkup")).toHaveLength(2);
    await handleTelegramUpdate(ctx, api, press("qd:1", 7));
    expect(String(messages(calls).at(-1)!.text)).toContain("Тест пройден: 2 из 2");
    expect(state(db).qz).toBeUndefined();
    expect(JSON.parse(quizRec(db)!.value)).toMatchObject({ attempts: 1, passed: true, best: 100 });
    const run = (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === `course_run_${ITEM}`,
    );
    expect(JSON.parse(run!.value).done).toEqual([id(1)]);
    // Повторно пройти пройденный тест нельзя.
    await handleTelegramUpdate(ctx, api, press(`qz:${ITEM}:1`, 8));
    expect(messages(calls).at(-1)!.text).toBe("Этот тест вы уже прошли.");
  });

  it("двойной тап по последнему ответу — одна попытка; провал не засчитывает урок", async () => {
    const { ctx, db, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`qz:${ITEM}:1`));
    await handleTelegramUpdate(ctx, api, press("qa:0:1", 2));
    await handleTelegramUpdate(ctx, api, press("qa:1:1", 3));
    await Promise.all([
      handleTelegramUpdate(ctx, api, press("qd:1", 4)),
      handleTelegramUpdate(ctx, api, press("qd:1", 5)),
    ]);
    expect(JSON.parse(quizRec(db)!.value)).toMatchObject({ attempts: 1, passed: false });
    const results = messages(calls).filter((m) => String(m.text).startsWith("Результат"));
    expect(results).toHaveLength(1);
    expect(String(results[0]!.text)).toContain("Нужно верных ответов: 100%");
  });

  it("закрытый урок: тест не стартует", async () => {
    const { ctx, db, api, calls } = school();
    await handleTelegramUpdate(ctx, api, press(`qz:${ITEM}:2`));
    expect(messages(calls).at(-1)!.text).toBe(
      "Тест сейчас недоступен: урок закрыт или у него нет теста.",
    );
    expect(state(db).qz).toBeUndefined();
  });
});

describe("эфиры потока в боте (Ш2)", () => {
  const C1 = "c1000000-0000-4000-8000-000000000001";
  const live = {
    id: "e0000000-0000-4000-8000-000000000001",
    title: "Разбор домашек",
    at: "2026-10-10T19:00", // 14:00 UTC
    link: "https://zoom.us/j/777",
  };
  function withLives() {
    const s = school();
    const row = (s.db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === courseKey(P),
    )!;
    row.value = JSON.stringify({
      ...course,
      cohorts: [
        { id: C1, title: "Октябрь", start: "2026-10-05T10:00", enrollUntil: null, lives: [live] },
      ],
    });
    return s;
  }
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });

  it("у курса с эфирами в «Мои курсы» есть кнопка «Эфиры»; без эфиров — нет", async () => {
    at("2026-10-08T10:00:00Z");
    const a = withLives();
    await handleTelegramUpdate(a.ctx, a.api, text("🎓 Мои курсы"));
    expect(buttons(messages(a.calls).at(-1)).map((x) => x.callback_data)).toContain(`lv:${ITEM}`);
    const b = school();
    await handleTelegramUpdate(b.ctx, b.api, text("🎓 Мои курсы", 2));
    expect(buttons(messages(b.calls).at(-1)).map((x) => x.callback_data)).not.toContain(
      `lv:${ITEM}`,
    );
  });

  it("до окна — время и «ссылка появится», самой ссылки в сообщении нет", async () => {
    at("2026-10-10T10:00:00Z");
    const { ctx, api, calls } = withLives();
    await handleTelegramUpdate(ctx, api, press(`lv:${ITEM}`));
    const m = messages(calls).at(-1)!;
    expect(String(m.text)).toContain("Разбор домашек");
    expect(String(m.text)).toContain("19:00");
    expect(String(m.text)).toContain("ссылка появится за 15 минут до начала");
    expect(JSON.stringify(m)).not.toContain("zoom.us");
  });

  it("за 15 минут до начала — кнопка со ссылкой; после — «прошёл» без ссылки", async () => {
    const { ctx, api, calls } = withLives();
    at("2026-10-10T13:46:00Z");
    await handleTelegramUpdate(ctx, api, press(`lv:${ITEM}`));
    expect(buttons(messages(calls).at(-1)).map((x) => x.url)).toContain("https://zoom.us/j/777");
    at("2026-10-10T18:00:00Z");
    await handleTelegramUpdate(ctx, api, press(`lv:${ITEM}`, 2));
    const m = messages(calls).at(-1)!;
    expect(String(m.text)).toContain("прошёл");
    expect(JSON.stringify(m)).not.toContain("zoom.us");
  });

  it("чужая покупка по подделанной кнопке — бот молчит", async () => {
    at("2026-10-10T13:50:00Z");
    const { ctx, db, api, calls } = withLives();
    (db.tables.orders![0] as Record<string, unknown>).telegram_id = 777;
    await handleTelegramUpdate(ctx, api, press(`lv:${ITEM}`));
    expect(messages(calls)).toEqual([]);
  });

  it("запись эфира: после начала — кнопка «Смотреть запись»; до начала — нет", async () => {
    const { ctx, db, api, calls } = withLives();
    const row = (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === courseKey(P),
    )!;
    const c = JSON.parse(row.value);
    c.cohorts[0].lives[0].recording = "https://rutube.ru/video/rec";
    row.value = JSON.stringify(c);
    at("2026-10-10T10:00:00Z");
    await handleTelegramUpdate(ctx, api, press(`lv:${ITEM}`));
    expect(JSON.stringify(messages(calls).at(-1))).not.toContain("rutube");
    at("2026-10-10T19:00:00Z");
    await handleTelegramUpdate(ctx, api, press(`lv:${ITEM}`, 2));
    const b = buttons(messages(calls).at(-1));
    expect(b.map((x) => x.url)).toEqual(["https://rutube.ru/video/rec"]);
    expect(b[0]!.text).toContain("Смотреть запись");
  });
});
