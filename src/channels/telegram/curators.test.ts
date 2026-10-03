import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { courseKey, type Course } from "@/core/courses/course";
import { hwFolder, hwKey, parseHomework } from "@/core/courses/homework";

/**
 * Кураторы школы: работа уходит одному назначенному куратору (не владельцу),
 * закрепляется за учеником, проверить её может только он (и продавец).
 * Bot API — шпион, база — фейковая, путь проверки — настоящий.
 */
const calls: Array<[string, Record<string, unknown>]> = [];
/** Кому Telegram не даёт писать (не нажал /start): 403. */
const blocked = new Set<number>();
const spyApi = {
  call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
    calls.push([method, payload]);
    if (blocked.has(Number(payload.chat_id))) return { ok: false, description: "Forbidden" };
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
const { ensureCurator } = await import("@/core/courses/curators.server");

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEMS = ["cccccccc-bbbb-cccc-dddd-eeeeeeeeee01", "cccccccc-bbbb-cccc-dddd-eeeeeeeeee02"];
const L1 = "00000000-0000-4000-8000-000000000001";
const OWNER = 900;
const ANNA = { id: "dddddddd-0000-4000-8000-000000000001", name: "Анна", telegram_id: 801 };
const BORIS = { id: "dddddddd-0000-4000-8000-000000000002", name: "Борис", telegram_id: 802 };

const course: Course = {
  schedule: { mode: "all" },
  lessons: [{ id: L1, title: "Кисти", text: "Урок", files: [], link: null, homework: "Круг" }],
};

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

function school(curators?: unknown): { ctx: TenantContext; db: FakeDb } {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.orders = ITEMS.map((item, i) => ({
    id: 5 + i,
    order_no: 5 + i,
    telegram_id: 40 + i,
    platform: "telegram",
    status: "delivered",
    display_name: `Ученик ${i + 1}`,
    user_key: `tg_${40 + i}`,
    total: 1000,
    currency: "KZT",
    order_items: [{ id: item, order_id: 5 + i, product_id: P, name_snapshot: "Аквагрим" }],
  }));
  db.tables.order_items = ITEMS.map((item, i) => ({
    id: item,
    order_id: 5 + i,
    product_id: P,
    name_snapshot: "Аквагрим",
  }));
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  const ctx = {
    tenant: {
      id: T,
      name: "Школа",
      status: "active",
      vertical: "courses",
      modules: { courses: true },
      ownerTelegramId: OWNER,
      telegramTokenEnc: "enc",
      settings: { default_locale: "ru", slug: "school", ...(curators ? { curators } : {}) },
    },
    secrets: { telegramToken: () => "t" },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { ctx, db };
}

async function submitted(ctx: TenantContext, item: string) {
  const p = (await coursePurchase(ctx, item))!;
  const r = await submitHomework(ctx, p, L1, {
    text: "Мой круг",
    files: [{ path: `${hwFolder(T, item)}a1.jpg`, name: null, mime: "image/jpeg" }],
  });
  if (!r.ok) throw new Error(r.reason);
  return r.homework;
}

const recipients = () =>
  [...new Set(calls.filter(([m]) => m === "sendMessage").map(([, p]) => Number(p.chat_id)))].sort();
const lastTo = (chatId: number) =>
  calls.filter(([m, p]) => m === "sendMessage" && Number(p.chat_id) === chatId).at(-1)?.[1];
const acceptOf = (p: Record<string, unknown> | undefined) =>
  (p?.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
    .inline_keyboard[0]![0]!.callback_data;
const press = (ctx: TenantContext, fromId: number, data: string, n: number) =>
  handleTelegramUpdate(
    ctx,
    spyApi as never,
    {
      update_id: n,
      callback_query: {
        id: `cq${n}`,
        from: { id: fromId, is_bot: false, first_name: "Куратор" },
        data,
        message: { message_id: 600, date: 0, chat: { id: fromId, type: "private" } },
      },
    } as never,
  );

describe("кураторы школы", () => {
  it("без кураторов работа идёт продавцу, как раньше", async () => {
    calls.length = 0;
    const { ctx } = school();
    await notifyHomework(ctx, await submitted(ctx, ITEMS[0]!));
    expect(recipients()).toEqual([OWNER]);
  });

  it("ученики по кругу; сдача того же ученика снова — тому же куратору, владельцу ничего", async () => {
    calls.length = 0;
    const { ctx } = school({ mode: "rotate", items: [ANNA, BORIS] });
    const w1 = await submitted(ctx, ITEMS[0]!);
    const w2 = await submitted(ctx, ITEMS[1]!);
    await notifyHomework(ctx, w1);
    await notifyHomework(ctx, w2);
    await notifyHomework(ctx, { ...w1, rev: 2 });
    const sentTo = calls.filter(([m]) => m === "sendMessage").map(([, p]) => Number(p.chat_id));
    expect(sentTo).toEqual([ANNA.telegram_id, BORIS.telegram_id, ANNA.telegram_id]);
    expect(recipients()).not.toContain(OWNER);
  });

  it("пять одновременных запросов на одного ученика — один куратор", async () => {
    const { ctx } = school({ mode: "rotate", items: [ANNA, BORIS] });
    const got = await Promise.all(Array.from({ length: 5 }, () => ensureCurator(ctx, ITEMS[0]!)));
    expect(new Set(got.map((c) => c?.id)).size).toBe(1);
  });

  it("по потокам: куратор потока получает своих учеников", async () => {
    const cohortId = "eeeeeeee-0000-4000-8000-000000000001";
    const { ctx, db } = school({
      mode: "cohort",
      items: [ANNA, { ...BORIS, cohorts: [cohortId] }],
    });
    (db.tables.app_settings as Array<Record<string, string>>).push({
      bot_id: T,
      key: `course_run_${ITEMS[0]}`,
      value: JSON.stringify({ startedAt: "2026-10-01T00:00:00Z", done: [], notified: 0, cohortId }),
    });
    expect((await ensureCurator(ctx, ITEMS[0]!))?.id).toBe(BORIS.id);
  });

  it("проверить может назначенный куратор; чужой куратор и посторонний — отказ", async () => {
    calls.length = 0;
    const { ctx, db } = school({ mode: "rotate", items: [ANNA, BORIS] });
    await notifyHomework(ctx, await submitted(ctx, ITEMS[0]!));
    const accept = acceptOf(lastTo(ANNA.telegram_id));

    await press(ctx, BORIS.telegram_id, accept, 1);
    expect(String(lastTo(BORIS.telegram_id)?.text)).toContain("назначена другому куратору");
    await press(ctx, 12345, accept, 2);
    expect(String(lastTo(12345)?.text)).toContain("только продавцу");
    const status = () =>
      parseHomework(
        (db.tables.app_settings as Array<{ key: string; value: string }>).find(
          (r) => r.key === hwKey(ITEMS[0]!, L1),
        )?.value,
      )?.status;
    expect(status()).toBe("submitted");

    await press(ctx, ANNA.telegram_id, accept, 3);
    expect(status()).toBe("accepted");
  });

  it("куратор недоступен для бота — работа уходит продавцу с пометкой, не теряется", async () => {
    calls.length = 0;
    blocked.add(ANNA.telegram_id);
    try {
      const { ctx } = school({ mode: "rotate", items: [ANNA, BORIS] });
      await notifyHomework(ctx, await submitted(ctx, ITEMS[0]!));
      const note = lastTo(OWNER)!;
      expect(String(note.text)).toContain("Куратору Анна не доставлено");
      expect(String(note.text)).toContain("Новое домашнее задание");
      // Кнопка «Принять» у продавца рабочая: он может проверить любую работу.
      expect(acceptOf(note)).toMatch(/^hwa:/);
    } finally {
      blocked.clear();
    }
  });
});
