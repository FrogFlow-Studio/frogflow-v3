import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { materialLanguages, productSellable } from "@/core/catalog/materials";
import { courseKey, type Course } from "./course";
import { COURSE_MARKER_URL, isCourseProduct, withoutCourseMarker } from "./marker";

vi.mock("@/config/env", () => ({
  env: () => ({ SECRETS_KEY: "test-secret", APP_URL: "https://www.frogflow.tech" }),
}));
vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { saveCourse } = await import("./course.server");
const { deliverOrder } = await import("@/core/orders/orders");

/**
 * Курс без файлов (ниша «Онлайн-школа»): товар продаётся, когда у курса есть
 * уроки, и при выдаче покупатель получает ссылку на уроки, а не метку.
 */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const lesson = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Урок ${n}`,
  text: "текст",
  files: [],
  link: null,
});
const withLessons: Course = { schedule: { mode: "all" }, lessons: [lesson(1)] };

function ctxWith(product: Record<string, unknown> = {}, slug: string | null = "school") {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [
    { id: P, bot_id: T, fulfillment_kind: "digital", file_url: null, ...product },
  ];
  db.tables.app_settings = [];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: { slug } },
    db,
    appUrl: "https://www.frogflow.tech",
  } as unknown as TenantContext;
  return { ctx, db };
}
const productRow = (db: ReturnType<typeof fakeDb>) =>
  (db.tables.products as Array<Record<string, unknown>>)[0]!;

describe("курс без файлов", () => {
  it("метка — «материал на русском»: товар продаётся; в отправке её нет", () => {
    const p = { fulfillment_kind: "digital", file_url: COURSE_MARKER_URL };
    expect(productSellable(p)).toBe(true);
    expect(materialLanguages(p)).toEqual(["ru"]);
    expect(isCourseProduct(p)).toBe(true);
    const link = { path: null, name: "Уроки курса", url: "https://x/s/school/course/1" };
    expect(withoutCourseMarker([{ path: null, name: null, url: COURSE_MARKER_URL }, link])).toEqual(
      [link],
    );
    expect(productSellable({ fulfillment_kind: "digital" })).toBe(false);
  });

  it("уроки появились — товар отмечен курсом; уроков не осталось — метка снята", async () => {
    const { ctx, db } = ctxWith();
    await saveCourse(ctx, P, withLessons);
    expect(productRow(db).file_url).toBe(COURSE_MARKER_URL);
    await saveCourse(ctx, P, { schedule: { mode: "all" }, lessons: [] });
    expect(productRow(db).file_url).toBeNull();
  });

  it("внешняя ссылка товара из v1 не затирается меткой", async () => {
    const { ctx, db } = ctxWith({ file_url: "https://drive.example/old.pdf" });
    await saveCourse(ctx, P, withLessons);
    expect(productRow(db).file_url).toBe("https://drive.example/old.pdf");
  });

  it("выдача курса без файлов — ссылка на уроки вместо метки", async () => {
    const { ctx, db } = ctxWith({ file_url: COURSE_MARKER_URL });
    (db.tables.app_settings as unknown[]).push({
      bot_id: T,
      key: courseKey(P),
      value: JSON.stringify(withLessons),
    });
    db.tables.orders = [{ id: 9, status: "paid", platform: "telegram", telegram_id: 1 }];
    db.tables.order_items = [
      {
        id: ITEM,
        order_id: 9,
        product_id: P,
        name_snapshot: "Курс",
        material_files_by_lang: { ru: [{ path: null, name: null, url: COURSE_MARKER_URL }] },
        delivered_language: null,
      },
    ];
    db.tables.order_events = [];
    db.tables.zernio_logs = [];
    const sent: Array<Array<{ url: string | null }>> = [];
    const r = await deliverOrder(ctx, 9, async (_item, materials) => {
      sent.push(materials);
      return "sent";
    });
    expect(r).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.map((m) => m.url)).toEqual([
      expect.stringMatching(/^https:\/\/www\.frogflow\.tech\/s\/school\/course\//),
    ]);
  });

  it("курс без адреса витрины: отправлять нечего — сбой выдачи, а не пустое сообщение", async () => {
    const { ctx, db } = ctxWith({ file_url: COURSE_MARKER_URL }, null);
    db.tables.orders = [{ id: 9, status: "paid", platform: "telegram", telegram_id: 1 }];
    db.tables.order_items = [
      {
        id: ITEM,
        order_id: 9,
        product_id: P,
        name_snapshot: "Курс",
        material_files_by_lang: { ru: [{ path: null, name: null, url: COURSE_MARKER_URL }] },
        delivered_language: null,
      },
    ];
    db.tables.order_events = [];
    db.tables.zernio_logs = [];
    const send = vi.fn(async () => "sent" as const);
    const r = await deliverOrder(ctx, 9, send);
    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, sent: 0, failed: 1 });
  });
});
