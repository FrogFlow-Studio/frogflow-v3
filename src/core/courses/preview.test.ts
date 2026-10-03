import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, parseCourse, type Course } from "./course";
import { coursePreview, openLessonFile, previewLesson } from "./preview.server";

/** Открытый урок (А22): содержимое до покупки только у урока с галочкой. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const lid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    {
      id: lid(1),
      title: "Знакомство",
      text: "ОТКРЫТЫЙ ТЕКСТ",
      files: [{ path: `${T}/course/free.pdf`, name: "Чек-лист" }],
      link: "https://youtu.be/abc",
      homework: "СЕКРЕТНОЕ ЗАДАНИЕ",
      preview: true,
    },
    {
      id: lid(2),
      title: "Платный",
      text: "ЗАКРЫТЫЙ ТЕКСТ",
      files: [{ path: `${T}/course/paid.pdf`, name: "Платный файл" }],
      link: "https://youtu.be/closed",
    },
    {
      id: lid(3),
      title: "Чужой файл",
      text: "т",
      files: [{ path: "other-tenant/x.pdf", name: null }],
      link: null,
      preview: true,
    },
  ],
};

function shop() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  return {
    tenant: { id: T, modules: { courses: true }, settings: { slug: "school" } },
    db,
    appUrl: "https://www.frogflow.tech",
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
}

describe("открытый урок на витрине", () => {
  it("открытый — с текстом, ссылкой и адресом файла на нашем маршруте; закрытый — только название", async () => {
    const view = await coursePreview(
      shop(),
      P,
      new Date("2026-10-01T00:00:00Z"),
      (no, idx) => `/api/course-file/school/${P}/${no}/${idx}`,
    );
    const [open, closed] = view!.lessons;
    expect(open!.open).toEqual({
      text: "ОТКРЫТЫЙ ТЕКСТ",
      link: "https://youtu.be/abc",
      files: [{ name: "Чек-лист", url: `/api/course-file/school/${P}/1/0` }],
    });
    expect(closed).toMatchObject({ title: "Платный", open: null });
    const json = JSON.stringify(view);
    for (const secret of ["ЗАКРЫТЫЙ", "closed", "СЕКРЕТНОЕ ЗАДАНИЕ", "paid.pdf", "files.test"])
      expect(json).not.toContain(secret);
  });

  it("карточка курса ничего не подписывает; файл с чужим префиксом в ней не виден", async () => {
    const view = await coursePreview(
      shop(),
      P,
      new Date("2026-10-01T00:00:00Z"),
      (no, idx) => `/f/${no}/${idx}`,
    );
    expect(view!.lessons[2]!.open).toMatchObject({ files: [] });
  });

  it("без адреса файлов нет, текст остаётся", async () => {
    const view = await coursePreview(shop(), P);
    expect(view!.lessons[0]!.open).toMatchObject({ text: "ОТКРЫТЫЙ ТЕКСТ", files: [] });
  });

  it("переход по ссылке: файл открытого урока подписывается в момент клика", async () => {
    const signed: Array<[string, string | null]> = [];
    const sign = async (path: string, name: string | null) => {
      signed.push([path, name]);
      return `https://files.test/${path}`;
    };
    expect(await openLessonFile(shop(), P, 1, 0, sign)).toBe(
      `https://files.test/${T}/course/free.pdf`,
    );
    expect(signed).toEqual([[`${T}/course/free.pdf`, "Чек-лист"]]);
  });

  it("закрытый урок, чужой путь, нет такого файла или урока — не подписываем", async () => {
    const sign = async () => {
      throw new Error("не должно подписывать");
    };
    expect(await openLessonFile(shop(), P, 2, 0, sign)).toBeNull(); // урок закрыт
    expect(await openLessonFile(shop(), P, 3, 0, sign)).toBeNull(); // путь чужого магазина
    expect(await openLessonFile(shop(), P, 1, 5, sign)).toBeNull(); // нет файла
    expect(await openLessonFile(shop(), P, 9, 0, sign)).toBeNull(); // нет урока
    expect(await openLessonFile(shop(), P, 0, 0, sign)).toBeNull();
    const off = shop();
    (off.tenant as { modules: Record<string, boolean> }).modules = { courses: false };
    expect(await openLessonFile(off, P, 1, 0, async () => "x")).toBeNull();
  });

  it("бот: урок по номеру — открытый отдаётся, закрытый и несуществующий — null", async () => {
    const sign = async (path: string) => `https://files.test/${path}`;
    expect((await previewLesson(shop(), P, 1, sign))?.title).toBe("Знакомство");
    expect(await previewLesson(shop(), P, 2, sign)).toBeNull();
    expect(await previewLesson(shop(), P, 9, sign)).toBeNull();
    expect(await previewLesson(shop(), P, 0, sign)).toBeNull();
  });

  it("галочка переживает разбор записи; чужое значение — не открывает", () => {
    expect(parseCourse(JSON.stringify(course)).lessons.map((l) => Boolean(l.preview))).toEqual([
      true,
      false,
      true,
    ]);
    const raw = JSON.stringify({
      ...course,
      lessons: [{ ...course.lessons[1], preview: "true" }],
    });
    expect(parseCourse(raw).lessons[0]!.preview).toBeUndefined();
  });
});
