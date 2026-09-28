import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, parseCourse, type Course } from "./course";
import { hwFolder, hwKey, parseHomework, submitProblem, withSubmission } from "./homework";

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

const {
  listHomework,
  purchaseHomework,
  reviewHomework,
  sniffHomeworkMime,
  submitHomework,
  uploadHomeworkFile,
} = await import("./homework.server");
const { coursePurchase, parseRun } = await import("./run.server");

/**
 * Домашние задания (ниша «Онлайн-школа»): ученик сдаёт ответ на открытый
 * урок с заданием, преподаватель принимает или возвращает на доработку.
 */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const course: Course = {
  schedule: { mode: "drip", everyDays: 3 },
  lessons: [
    {
      id: id(1),
      title: "Урок 1",
      text: "Кисти",
      files: [],
      link: null,
      homework: "Нарисуйте круг",
    },
    { id: id(2), title: "Урок 2", text: "Цвет", files: [], link: null, homework: "Смешайте цвета" },
    { id: id(3), title: "Урок 3", text: "Итоги", files: [], link: null },
  ],
};
const NOW = new Date("2026-10-01T10:00:00Z");

function ctxWith() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.order_items = [
    { id: ITEM, order_id: 5, product_id: P, name_snapshot: "Аквагрим с нуля" },
  ];
  db.tables.orders = [
    {
      id: 5,
      status: "delivered",
      platform: "telegram",
      telegram_id: 777,
      display_name: "Мария",
      username: "masha",
      user_key: "tg_777",
    },
  ];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}
const purchase = async (ctx: TenantContext) => (await coursePurchase(ctx, ITEM))!;
const settings = (db: ReturnType<typeof fakeDb>) =>
  db.tables.app_settings as Array<{ key: string; value: string }>;

describe("задание в уроке", () => {
  it("задание урока читается из записи курса, урок без задания — без него", () => {
    const c = parseCourse(JSON.stringify(course));
    expect(c.lessons[0]!.homework).toBe("Нарисуйте круг");
    expect(c.lessons[2]!.homework).toBeUndefined();
  });
});

describe("сдача домашнего задания", () => {
  it("ученик сдаёт ответ на открытый урок — запись «на проверке» с его именем", async () => {
    const { ctx } = ctxWith();
    const r = await submitHomework(
      ctx,
      await purchase(ctx),
      id(1),
      { text: "Готово", files: [] },
      NOW,
    );
    expect(r).toMatchObject({
      ok: true,
      homework: { status: "submitted", student: "Мария", lessonNo: 1 },
    });
    const map = await purchaseHomework(ctx, ITEM);
    expect(map.get(id(1))?.attempts.map((a) => a.text)).toEqual(["Готово"]);
  });

  it("закрытый по расписанию урок и урок без задания — не сдать", async () => {
    const { ctx } = ctxWith();
    const p = await purchase(ctx);
    expect(await submitHomework(ctx, p, id(2), { text: "рано", files: [] }, NOW)).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(await submitHomework(ctx, p, id(3), { text: "нет ДЗ", files: [] }, NOW)).toEqual({
      ok: false,
      reason: "noHomework",
    });
  });

  it("пустой ответ и чужой файл не принимаются", () => {
    expect(submitProblem(T, null, { orderItemId: ITEM, text: " ", files: [] })).toBe("empty");
    expect(
      submitProblem(T, null, {
        orderItemId: ITEM,
        text: "",
        files: [{ path: `${T}/hw/другая-покупка/x.jpg`, name: null, mime: "image/jpeg" }],
      }),
    ).toBe("foreignFile");
    expect(
      submitProblem(T, null, {
        orderItemId: ITEM,
        text: "",
        files: [{ path: `${hwFolder(T, ITEM)}ok.jpg`, name: null, mime: "image/jpeg" }],
      }),
    ).toBeNull();
  });

  it("файл ответа проверяется по содержимому и кладётся в папку покупки", async () => {
    const { ctx } = ctxWith();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = await uploadHomeworkFile(ctx, ITEM, jpeg, "рисунок.jpg");
    expect(r).toMatchObject({ ok: true, file: { mime: "image/jpeg", name: "рисунок.jpg" } });
    expect(uploads.at(-1)).toMatch(new RegExp(`^${hwFolder(T, ITEM)}[0-9a-f]{24}\\.jpg$`));
    const html = new TextEncoder().encode("<html>не картинка</html>");
    expect(await uploadHomeworkFile(ctx, ITEM, html, "x.jpg")).toEqual({
      ok: false,
      reason: "badType",
    });
    expect(sniffHomeworkMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
  });
});

describe("проверка преподавателем", () => {
  it("на доработку — с комментарием; новая сдача после этого снова «на проверке»", async () => {
    const { ctx } = ctxWith();
    const p = await purchase(ctx);
    const first = await submitHomework(ctx, p, id(1), { text: "v1", files: [] }, NOW);
    const rev = first.ok ? first.homework.rev : -1;
    expect(
      await reviewHomework(
        ctx,
        ITEM,
        id(1),
        { rev, status: "revise", text: "", by: "Анастасия" },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "emptyRevise" });
    const back = await reviewHomework(
      ctx,
      ITEM,
      id(1),
      { rev, status: "revise", text: "Круг кривой", by: "Анастасия" },
      NOW,
    );
    expect(back).toMatchObject({
      ok: true,
      homework: { status: "revise", feedback: { text: "Круг кривой" } },
      notify: { telegramId: 777, platform: "telegram", orderId: 5 },
    });
    const second = await submitHomework(ctx, p, id(1), { text: "v2", files: [] }, NOW);
    expect(second).toMatchObject({ ok: true, homework: { status: "submitted" } });
    // Отзыв на прошлую версию остаётся виден, пока нет нового.
    expect(second.ok && second.homework.feedback?.text).toBe("Круг кривой");
    expect(second.ok && second.homework.attempts.map((a) => a.text)).toEqual(["v1", "v2"]);
  });

  it("принятое задание отмечает урок пройденным и больше не сдаётся", async () => {
    const { ctx, db } = ctxWith();
    const p = await purchase(ctx);
    const s = await submitHomework(ctx, p, id(1), { text: "готово", files: [] }, NOW);
    const rev = s.ok ? s.homework.rev : -1;
    const ok = await reviewHomework(
      ctx,
      ITEM,
      id(1),
      { rev, status: "accepted", text: "Отлично", by: "А" },
      NOW,
    );
    expect(ok).toMatchObject({ ok: true, homework: { status: "accepted" } });
    const run = parseRun(settings(db).find((r) => r.key === `course_run_${ITEM}`)?.value);
    expect(run?.done).toEqual([id(1)]);
    expect(await submitHomework(ctx, p, id(1), { text: "ещё", files: [] }, NOW)).toEqual({
      ok: false,
      reason: "accepted",
    });
  });

  it("ученик прислал новую версию, пока преподаватель смотрел старую, — проверка не затирает её", async () => {
    const { ctx } = ctxWith();
    const p = await purchase(ctx);
    const a = await submitHomework(ctx, p, id(1), { text: "v1", files: [] }, NOW);
    await submitHomework(ctx, p, id(1), { text: "v2", files: [] }, NOW);
    const stale = a.ok ? a.homework.rev : -1;
    expect(
      await reviewHomework(
        ctx,
        ITEM,
        id(1),
        { rev: stale, status: "accepted", text: "", by: "А" },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("очередь: на проверке — первыми, по давности сдачи", async () => {
    const { ctx, db } = ctxWith();
    const mk = (lesson: string, status: string, updatedAt: string) => ({
      bot_id: T,
      key: hwKey(ITEM, lesson),
      value: JSON.stringify({
        ...withSubmission(
          null,
          {
            orderItemId: ITEM,
            lessonId: lesson,
            productId: P,
            course: "К",
            lessonNo: 1,
            lessonTitle: "У",
            student: "М",
            text: "x",
            files: [],
          },
          new Date(updatedAt),
        ),
        status,
      }),
    });
    settings(db).push(
      mk(id(1), "accepted", "2026-10-01T09:00:00Z"),
      mk(id(2), "submitted", "2026-10-01T08:00:00Z"),
      mk(id(3), "submitted", "2026-09-30T08:00:00Z"),
    );
    const list = await listHomework(ctx);
    expect(list.map((h) => [h.lessonId, h.status])).toEqual([
      [id(3), "submitted"],
      [id(2), "submitted"],
      [id(1), "accepted"],
    ]);
    expect(parseHomework("не json")).toBeNull();
  });
});

describe("альбом Telegram", () => {
  it("части одного альбома — одна сдача; новый альбом после проверки — новая версия", async () => {
    const { ctx } = ctxWith();
    const p = await purchase(ctx);
    const f = (n: number) => ({
      path: `${hwFolder(T, ITEM)}${n}.jpg`,
      name: null,
      mime: "image/jpeg",
    });
    const a = await submitHomework(ctx, p, id(1), { text: "", files: [f(1)], group: "g1" }, NOW);
    const b = await submitHomework(ctx, p, id(1), { text: "", files: [f(2)], group: "g1" }, NOW);
    expect(a).toMatchObject({ ok: true, merged: false });
    expect(b).toMatchObject({ ok: true, merged: true });
    expect(b.ok && b.homework.attempts.map((x) => x.files.length)).toEqual([2]);
    const rev = b.ok ? b.homework.rev : -1;
    await reviewHomework(ctx, ITEM, id(1), { rev, status: "revise", text: "ещё", by: "А" }, NOW);
    const c = await submitHomework(ctx, p, id(1), { text: "", files: [f(3)], group: "g1" }, NOW);
    expect(c).toMatchObject({ ok: true, merged: false });
    expect(c.ok && c.homework.attempts).toHaveLength(2);
  });

  it("альбом больше пяти файлов — шестой не принимается", async () => {
    const { ctx } = ctxWith();
    const p = await purchase(ctx);
    const f = (n: number) => ({
      path: `${hwFolder(T, ITEM)}${n}.jpg`,
      name: null,
      mime: "image/jpeg",
    });
    for (const n of [1, 2, 3, 4, 5])
      await submitHomework(ctx, p, id(1), { text: "", files: [f(n)], group: "g" }, NOW);
    expect(
      await submitHomework(ctx, p, id(1), { text: "", files: [f(6)], group: "g" }, NOW),
    ).toEqual({
      ok: false,
      reason: "tooManyFiles",
    });
  });
});
