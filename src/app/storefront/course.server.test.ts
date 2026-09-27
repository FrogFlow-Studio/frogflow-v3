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
    expect(v.lessons[1]).toMatchObject({ text: "", link: null, files: [] });
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
