import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, type Course } from "@/core/courses/course";
import { hwFolder, hwKey, parseHomework } from "@/core/courses/homework";

/**
 * Проверка ДЗ из Telegram: уведомление с фото и меткой работы, ответ
 * свайпом — комментарий, кнопки — оценка; ученик получает сообщение.
 * Bot API — шпион, база — фейковая, путь проверки — настоящий.
 */
const calls: Array<[string, Record<string, unknown>]> = [];
const spyApi = {
  call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
    calls.push([method, payload]);
    return { ok: true, result: { message_id: 500 + calls.length } };
  }),
  fileUrl: (p: string) => `https://files.test/${p}`,
};
vi.mock("@/channels/telegram/api", () => ({ telegramApi: () => spyApi }));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.test/${path}?sig=1` },
          error: null,
        }),
      }),
    },
  }),
}));

const { handleTelegramUpdate } = await import("./handle-update");
const { notifyHomework } = await import("./course-notify");
const { submitHomework } = await import("@/core/courses/homework.server");
const { coursePurchase } = await import("@/core/courses/run.server");

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const L1 = "00000000-0000-4000-8000-000000000001";
const TEACHER = 900;
const STUDENT = 42;

const course: Course = {
  schedule: { mode: "all" },
  lessons: [{ id: L1, title: "Кисти", text: "Урок", files: [], link: null, homework: "Круг" }],
};

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

function school(): { ctx: TenantContext; db: FakeDb } {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  const order = {
    id: 5,
    order_no: 5,
    telegram_id: STUDENT,
    platform: "telegram",
    status: "delivered",
    display_name: "Мария",
    user_key: `tg_${STUDENT}`,
    total: 1000,
    currency: "KZT",
  };
  db.tables.orders = [
    {
      ...order,
      order_items: [{ id: ITEM, order_id: 5, product_id: P, name_snapshot: "Аквагрим" }],
    },
  ];
  db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: P, name_snapshot: "Аквагрим" }];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  const ctx = {
    tenant: {
      id: T,
      name: "Школа",
      status: "active",
      vertical: "courses",
      modules: { courses: true },
      ownerTelegramId: TEACHER,
      telegramTokenEnc: "enc",
      settings: { default_locale: "ru", slug: "school" },
    },
    secrets: { telegramToken: () => "t" },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

async function submitted(ctx: TenantContext) {
  const p = (await coursePurchase(ctx, ITEM))!;
  const r = await submitHomework(ctx, p, L1, {
    text: "Мой круг",
    files: [{ path: `${hwFolder(T, ITEM)}a1.jpg`, name: null, mime: "image/jpeg" }],
  });
  if (!r.ok) throw new Error(r.reason);
  return r.homework;
}

const teacher = { id: TEACHER, is_bot: false, first_name: "Анастасия" };
const lastTo = (chatId: number) =>
  calls.filter(([m, p]) => m === "sendMessage" && Number(p.chat_id) === chatId).at(-1)?.[1];
const hw = (db: FakeDb) =>
  parseHomework(
    (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === hwKey(ITEM, L1),
    )?.value,
  );
const buttonsOf = (p: Record<string, unknown> | undefined) =>
  (
    (p?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
      ?.inline_keyboard ?? []
  )
    .flat()
    .map((b) => b.callback_data);

describe("проверка ДЗ из Telegram", () => {
  it("уведомление: фото работы, метка, кнопка «Принять»", async () => {
    calls.length = 0;
    const { ctx } = school();
    const work = await submitted(ctx);
    await notifyHomework(ctx, work);
    const photo = calls.find(([m]) => m === "sendPhoto")?.[1];
    expect(String(photo?.photo)).toContain(`${hwFolder(T, ITEM)}a1.jpg`);
    const note = lastTo(TEACHER)!;
    expect(String(note.text)).toMatch(/\[#hw:[0-9a-f]{12}\]/);
    expect(buttonsOf(note)).toEqual([expect.stringMatching(/^hwa:[0-9a-f]{12}:1$/)]);
  });

  it("ответ свайпом → «На доработку»: ученику комментарий, работа — на доработке", async () => {
    calls.length = 0;
    const { ctx, db } = school();
    await notifyHomework(ctx, await submitted(ctx));
    const note = lastTo(TEACHER)!;
    await handleTelegramUpdate(
      ctx,
      spyApi as never,
      {
        update_id: 1,
        message: {
          message_id: 77,
          date: 0,
          chat: { id: TEACHER, type: "private" },
          from: teacher,
          text: "Круг кривоват, попробуйте циркулем",
          reply_to_message: { message_id: 1, text: String(note.text).replace(/<[^>]+>/g, "") },
        },
      } as never,
    );
    const ask = lastTo(TEACHER)!;
    const revise = buttonsOf(ask).find((d) => d.startsWith("hwv:"))!;
    expect(revise).toMatch(/^hwv:[0-9a-f]{12}:1:77$/);

    await handleTelegramUpdate(
      ctx,
      spyApi as never,
      {
        update_id: 2,
        callback_query: {
          id: "cq",
          from: teacher,
          data: revise,
          message: { message_id: 600, date: 0, chat: { id: TEACHER, type: "private" } },
        },
      } as never,
    );
    expect(hw(db)).toMatchObject({
      status: "revise",
      feedback: { text: "Круг кривоват, попробуйте циркулем", by: "Анастасия" },
    });
    expect(String(lastTo(STUDENT)?.text)).toContain("Круг кривоват");
    expect(String(lastTo(TEACHER)?.text)).toContain("Ученик получил сообщение");
    expect(calls.some(([m]) => m === "editMessageReplyMarkup")).toBe(true);
  });

  it("«Принять» из уведомления; повторное нажатие — «уже проверена»; чужому — отказ", async () => {
    calls.length = 0;
    const { ctx, db } = school();
    await notifyHomework(ctx, await submitted(ctx));
    const accept = buttonsOf(lastTo(TEACHER))[0]!;
    const press = (from: typeof teacher, n: number) =>
      handleTelegramUpdate(
        ctx,
        spyApi as never,
        {
          update_id: n,
          callback_query: {
            id: `cq${n}`,
            from,
            data: accept,
            message: { message_id: 600, date: 0, chat: { id: from.id, type: "private" } },
          },
        } as never,
      );
    await press({ ...teacher, id: 1234 }, 1);
    expect(String(lastTo(1234)?.text)).toContain("только продавцу");
    expect(hw(db)?.status).toBe("submitted");
    await press(teacher, 2);
    expect(hw(db)?.status).toBe("accepted");
    await press(teacher, 3);
    expect(String(lastTo(TEACHER)?.text)).toBe("Эта работа уже проверена.");
  });

  it("«На доработку» без комментария не ставится", async () => {
    calls.length = 0;
    const { ctx, db } = school();
    const work = await submitted(ctx);
    await notifyHomework(ctx, work);
    const ref = String(lastTo(TEACHER)!.text).match(/\[#hw:([0-9a-f]{12})\]/)![1];
    await handleTelegramUpdate(
      ctx,
      spyApi as never,
      {
        update_id: 1,
        callback_query: {
          id: "cq",
          from: teacher,
          data: `hwv:${ref}:${work.rev}`,
          message: { message_id: 600, date: 0, chat: { id: TEACHER, type: "private" } },
        },
      } as never,
    );
    expect(String(lastTo(TEACHER)?.text)).toContain("ответьте свайпом");
    expect(hw(db)?.status).toBe("submitted");
  });
});

describe("быстрые ответы куратора в Telegram (А35)", () => {
  const swipe = async (ctx: TenantContext, note: Record<string, unknown>, text: string, id = 90) =>
    handleTelegramUpdate(
      ctx,
      spyApi as never,
      {
        update_id: id,
        message: {
          message_id: id,
          date: 0,
          chat: { id: TEACHER, type: "private" },
          from: teacher,
          text,
          reply_to_message: { message_id: 1, text: String(note.text).replace(/<[^>]+>/g, "") },
        },
      } as never,
    );
  const withReplies = async () => {
    calls.length = 0;
    const { ctx, db } = school();
    (ctx.tenant.settings as Record<string, unknown>).homework_replies = [
      { title: "Молодец", text: "Отлично, {name}! Работа принята." },
      { title: "Доработать", text: "Переделайте второй шаг." },
    ];
    await notifyHomework(ctx, await submitted(ctx));
    return { ctx, db, note: lastTo(TEACHER)! };
  };
  const draftOf = (db: FakeDb) =>
    (db.tables.app_settings as Array<{ key: string; value: string }>).find((r) =>
      r.key.startsWith("course_hwdraft_"),
    )?.value;

  it("«#» отвечает списком шаблонов и ничего не пишет в работу", async () => {
    const { ctx, db, note } = await withReplies();
    await swipe(ctx, note, "#");
    const list = String(lastTo(TEACHER)?.text);
    expect(list).toContain("1. Молодец");
    expect(list).toContain("2. Доработать");
    expect(buttonsOf(lastTo(TEACHER))).toEqual([]);
    expect(hw(db)).toMatchObject({ status: "submitted" });
    expect(draftOf(db)).toBeUndefined();
  });

  it("«#1 слова» — комментарий из шаблона с именем ученика; кнопки оценивают именно его", async () => {
    const { ctx, db, note } = await withReplies();
    await swipe(ctx, note, "#1 Так держать.");
    const ask = lastTo(TEACHER)!;
    expect(String(ask.text)).toContain("Отлично, Мария! Работа принята.");
    const accept = buttonsOf(ask).find((d) => d.startsWith("hwa:"))!;
    await handleTelegramUpdate(
      ctx,
      spyApi as never,
      {
        update_id: 91,
        callback_query: {
          id: "cq91",
          from: teacher,
          data: accept,
          message: { message_id: 600, date: 0, chat: { id: TEACHER, type: "private" } },
        },
      } as never,
    );
    expect(hw(db)).toMatchObject({
      status: "accepted",
      feedback: { text: "Отлично, Мария! Работа принята.\n\nТак держать." },
    });
    expect(String(lastTo(STUDENT)?.text)).toContain("Отлично, Мария!");
  });

  it("несуществующий номер — подсказка, обычный текст с «#» в середине остаётся комментарием", async () => {
    const { ctx, note } = await withReplies();
    await swipe(ctx, note, "#7");
    expect(String(lastTo(TEACHER)?.text)).toContain("№7 нет");
    await swipe(ctx, note, "Круг кривоват #1", 92);
    expect(String(lastTo(TEACHER)?.text)).toContain("Как отметить?");
    expect(String(lastTo(TEACHER)?.text)).not.toContain("Отлично");
  });
});
