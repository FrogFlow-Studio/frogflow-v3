import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { storefrontAllows, storefrontOpen } from "@/core/storefront/access";
import { courseKey, type Course } from "@/core/courses/course";
import { courseToken } from "@/core/courses/link";
import { runKey } from "@/core/courses/run.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseView, openCourse } from "./course.server";

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const S = "secret";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const course: Course = {
  schedule: { mode: "drip", everyDays: 3 },
  lessons: [1, 2].map((n) => ({
    id: id(n),
    title: `Урок ${n}`,
    text: `Текст ${n}`,
    files: [{ path: `${T}/l${n}.pdf`, name: `l${n}.pdf` }],
    link: `https://youtu.be/${n}`,
  })),
};

function ctxWith(status = "delivered") {
  const db = fakeDb();
  db.tables.order_items = [{ id: ITEM, order_id: 5, product_id: P, name_snapshot: "Курс лепки" }];
  db.tables.orders = [{ id: 5, status }];
  db.tables.app_settings = [{ key: courseKey(P), value: JSON.stringify(course) }];
  return { ctx: { tenant: { id: T }, db } as unknown as TenantContext, db };
}

describe("страница курса на витрине", () => {
  it("открыта только при модуле курсов и только клиенту v2", () => {
    expect(storefrontAllows({ shop: true, courses: true }, "course")).toBe(true);
    expect(storefrontAllows({ shop: true }, "course")).toBe(false);
    const t = { archived: false, settings: { served_by: "v2" as const } };
    expect(storefrontOpen({ ...t, modules: { shop: true, courses: true } }, "course")).toBe(true);
    expect(storefrontOpen({ ...t, modules: { shop: true } }, "course")).toBe(false);
    // Клиент прежней платформы для v2 невидим, даже с включёнными курсами.
    const v1 = { archived: false, settings: {}, modules: { shop: true, courses: true } };
    expect(storefrontOpen(v1, "course")).toBe(false);
  });

  it("чужая подпись, невыданный заказ — не найдено", async () => {
    const { ctx } = ctxWith();
    expect(await openCourse(ctx, S, ITEM, "x".repeat(22))).toBeNull();
    const pending = ctxWith("awaiting_confirmation").ctx;
    expect(await openCourse(pending, S, ITEM, courseToken(S, T, ITEM))).toBeNull();
    expect(await openCourse(ctx, S, ITEM, courseToken(S, T, ITEM))).not.toBeNull();
  });

  it("закрытый урок не отдаёт текст, ссылку и файлы; отсчёт — с первого открытия", async () => {
    const { ctx, db } = ctxWith();
    const p = (await openCourse(ctx, S, ITEM, courseToken(S, T, ITEM)))!;
    const signed: string[] = [];
    const sign = async (path: string) => {
      signed.push(path);
      return `https://files/${path}`;
    };
    const now = new Date("2026-10-01T10:00:00Z");
    const v = await courseView(ctx, p, sign, now);
    expect(v.name).toBe("Курс лепки");
    expect(v.lessons.map((l) => l.open)).toEqual([true, false]);
    expect(v.lessons[0]).toMatchObject({ text: "Текст 1", link: "https://youtu.be/1" });
    // «1» — не id YouTube из 11 знаков: плеера нет, остаётся кнопка-ссылка.
    expect(v.lessons[0]!.embed).toBeNull();
    expect(v.lessons[1]).toMatchObject({ text: "", link: null, embed: null, files: [] });
    expect(signed).toEqual([`${T}/l1.pdf`]);
    expect(v.nextAt).toBe("2026-10-04T10:00:00.000Z");
    const run = db.tables.app_settings!.find((r) => r.key === runKey(ITEM));
    expect(JSON.parse(String(run!.value)).startedAt).toBe(now.toISOString());
  });

  it("файл урока с чужим префиксом не подписывается, даже если попал в строку курса", async () => {
    const { ctx, db } = ctxWith();
    const foreign = "99999999-2222-3333-4444-555555555555/secret.pdf";
    const tampered: Course = {
      ...course,
      schedule: { mode: "all" },
      lessons: [
        {
          ...course.lessons[0]!,
          files: [{ path: foreign, name: "x.pdf" }, ...course.lessons[0]!.files],
        },
      ],
    };
    db.tables.app_settings = [{ key: courseKey(P), value: JSON.stringify(tampered) }];
    const p = (await openCourse(ctx, S, ITEM, courseToken(S, T, ITEM)))!;
    const signed: string[] = [];
    const v = await courseView(ctx, p, async (path) => {
      signed.push(path);
      return `https://files/${path}`;
    });
    expect(signed).toEqual([`${T}/l1.pdf`]);
    expect(v.lessons[0]!.files.map((f) => f.name)).toEqual(["l1.pdf"]);
  });
});

describe("домашнее задание на странице курса", () => {
  it("у открытого урока с заданием — задание и статус последней сдачи; у закрытого — ничего", async () => {
    const { submitHomework } = await import("@/core/courses/homework.server");
    const { ctx, db } = ctxWith();
    const withHw: Course = {
      ...course,
      lessons: course.lessons.map((l) => ({ ...l, homework: `Задание к ${l.title}` })),
    };
    (db.tables.app_settings as Array<{ key: string; value: string }>)[0]!.value =
      JSON.stringify(withHw);
    db.tables.orders = [{ id: 5, status: "delivered", display_name: "Ученик" }];
    const p = (await openCourse(ctx, S, ITEM, courseToken(S, T, ITEM)))!;
    await submitHomework(ctx, p, withHw.lessons[0]!.id, { text: "мой ответ", files: [] });
    const view = await courseView(ctx, p, async (path) => `https://files/${path}`);
    expect(view.lessons[0]!.homework).toMatchObject({
      task: "Задание к Урок 1",
      status: "submitted",
      last: { text: "мой ответ", files: [] },
      feedback: null,
    });
    // Урок 2 по расписанию ещё закрыт: задание не уходит в браузер.
    expect(view.lessons[1]!.homework).toBeNull();
  });
});

describe("плеер урока", () => {
  it("у открытого урока с видео — адрес плеера, у закрытого — нет", async () => {
    const { ctx, db } = ctxWith();
    const yt = "dQw4w9WgXcQ";
    (db.tables.app_settings as Array<{ key: string; value: string }>)[0]!.value = JSON.stringify({
      ...course,
      lessons: course.lessons.map((l) => ({ ...l, link: `https://youtu.be/${yt}` })),
    });
    const p = (await openCourse(ctx, S, ITEM, courseToken(S, T, ITEM)))!;
    const v = await courseView(ctx, p, async (path) => path, new Date("2026-10-01T10:00:00Z"));
    expect(v.lessons.map((l) => l.embed)).toEqual([
      `https://www.youtube-nocookie.com/embed/${yt}`,
      null,
    ]);
  });
});

describe("эфиры на странице курса (Ш2)", () => {
  const C1 = "c1000000-0000-4000-8000-000000000001";
  const live = {
    id: "e0000000-0000-4000-8000-000000000001",
    title: "Разбор",
    at: "2026-10-10T19:00",
    link: "https://zoom.us/j/777",
  };
  function shop(accessDays?: number) {
    const { ctx, db } = ctxWith();
    (ctx as unknown as { timezone: string }).timezone = "Asia/Almaty";
    const tariffs = accessDays
      ? { tariffs: { [id(50)]: { homework: true, channel: true, accessDays } } }
      : {};
    db.tables.app_settings = [
      {
        key: courseKey(P),
        value: JSON.stringify({
          ...course,
          cohorts: [
            {
              id: C1,
              title: "Октябрь",
              start: "2026-10-05T10:00",
              enrollUntil: null,
              lives: [live],
            },
          ],
          ...tariffs,
        }),
      },
    ];
    return ctx;
  }
  const open = async (ctx: TenantContext, now: string) => {
    const p = (await openCourse(ctx, S, ITEM, courseToken(S, T, ITEM)))!;
    return courseView(ctx, p, async (path) => `https://files/${path}`, new Date(now));
  };

  it("до окна ссылка не уходит в браузер, в окне — уходит, потом снова нет", async () => {
    const ctx = shop();
    const early = await open(ctx, "2026-10-10T10:00:00Z");
    expect(early.lives).toHaveLength(1);
    expect(early.lives[0]).toMatchObject({ status: "upcoming", link: null });
    expect(JSON.stringify(early)).not.toContain("zoom.us/j/777");
    const soon = await open(ctx, "2026-10-10T13:50:00Z");
    expect(soon.lives[0]).toMatchObject({ status: "open", link: "https://zoom.us/j/777" });
    const after = await open(ctx, "2026-10-10T20:00:00Z");
    expect(after.lives[0]).toMatchObject({ status: "past", link: null });
  });

  it("ученик с закончившимся доступом эфиров не видит, с действующим — видит", async () => {
    const ctx = shop(3); // тариф варианта: доступ 3 дня от старта потока (5 октября)
    const db = (ctx as unknown as { db: ReturnType<typeof fakeDb> }).db;
    (db.tables.order_items as Array<Record<string, unknown>>)[0]!.product_variant_id = id(50);
    const live10 = await open(ctx, "2026-10-07T13:50:00Z"); // доступ ещё открыт
    expect(live10.expired).toBe(false);
    expect(live10.lives).toHaveLength(1);
    const late = await open(ctx, "2026-10-10T13:50:00Z"); // доступ закончился
    expect(late.expired).toBe(true);
    expect(late.lives).toEqual([]);
    expect(JSON.stringify(late)).not.toContain("zoom.us/j/777");
  });

  it("запись эфира: после начала доступна ученику, до начала и без доступа — нет", async () => {
    const ctx = shop(3);
    const db = (ctx as unknown as { db: ReturnType<typeof fakeDb> }).db;
    (db.tables.order_items as Array<Record<string, unknown>>)[0]!.product_variant_id = id(50);
    const row = (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === courseKey(P),
    )!;
    const c = JSON.parse(row.value);
    c.cohorts[0].lives[0].recording = "https://youtu.be/dQw4w9WgXcQ";
    c.cohorts[0].start = "2026-10-08T10:00";
    c.cohorts[0].lives[0].at = "2026-10-08T19:00"; // старт потока 8 октября, доступ 3 дня
    row.value = JSON.stringify(c);
    const before = await open(ctx, "2026-10-08T10:00:00Z");
    expect(before.lives[0]!.recording).toBeNull();
    const ok = await open(ctx, "2026-10-09T10:00:00Z"); // 3 часа после эфира
    expect(ok.expired).toBe(false);
    expect(ok.lives[0]).toMatchObject({
      status: "past",
      recording: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(ok.lives[0]!.recordingEmbed).toContain("youtube");
    const late = await open(ctx, "2026-10-13T10:00:00Z"); // доступ закончился
    expect(late.expired).toBe(true);
    expect(JSON.stringify(late)).not.toContain("youtu.be");
  });
});
