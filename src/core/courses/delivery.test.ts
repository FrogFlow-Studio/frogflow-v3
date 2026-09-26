import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "./course";
import { COURSE_LINK_NAME, courseMaterials } from "./delivery.server";
import { isCourseToken } from "./link";

vi.mock("@/config/env", () => ({
  env: () => ({ SECRETS_KEY: "test-secret", APP_URL: "https://www.frogflow.tech" }),
}));

const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ITEM = "cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee";
const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    { id: "00000000-0000-4000-8000-000000000001", title: "1", text: "т", files: [], link: null },
  ],
};

function ctxWith(opts: { courses?: boolean; slug?: string | null; lessons?: boolean } = {}) {
  const db = fakeDb();
  db.tables.app_settings =
    opts.lessons === false ? [] : [{ key: courseKey(P), value: JSON.stringify(course) }];
  return {
    tenant: {
      id: T,
      modules: { courses: opts.courses ?? true },
      settings: { slug: opts.slug === undefined ? "shop" : opts.slug },
    },
    db,
    appUrl: "https://www.frogflow.tech",
  } as unknown as TenantContext;
}

describe("курс — ссылка в выдаче", () => {
  it("курс с уроками — одна ссылка на страницу курса с верной подписью", async () => {
    const [m, ...rest] = await courseMaterials(ctxWith(), { id: ITEM, product_id: P });
    expect(rest).toEqual([]);
    expect(m!.name).toBe(COURSE_LINK_NAME);
    expect(m!.path).toBeNull();
    const url = new URL(m!.url!);
    expect(url.origin + url.pathname).toBe(`https://www.frogflow.tech/s/shop/course/${ITEM}`);
    expect(isCourseToken("test-secret", T, ITEM, url.searchParams.get("k")!)).toBe(true);
  });

  it("без модуля, без уроков, без адреса витрины или без товара — ничего", async () => {
    const item = { id: ITEM, product_id: P };
    expect(await courseMaterials(ctxWith({ courses: false }), item)).toEqual([]);
    expect(await courseMaterials(ctxWith({ lessons: false }), item)).toEqual([]);
    expect(await courseMaterials(ctxWith({ slug: null }), item)).toEqual([]);
    expect(await courseMaterials(ctxWith(), { id: ITEM, product_id: null })).toEqual([]);
  });
});
