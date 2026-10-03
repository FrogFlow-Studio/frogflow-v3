import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, type Course } from "@/core/courses/course";

/**
 * Файлы открытых уроков по переходу (А33): подпись ставится в момент клика,
 * закрытый урок и чужой путь — 404, клиент прежней платформы невидим, лимит — 429.
 */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const lid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const course: Course = {
  schedule: { mode: "all" },
  lessons: [
    {
      id: lid(1),
      title: "Открытый",
      text: "т",
      files: [{ path: `${T}/course/free.pdf`, name: "Чек-лист" }],
      link: null,
      preview: true,
    },
    {
      id: lid(2),
      title: "Закрытый",
      text: "т",
      files: [{ path: `${T}/course/paid.pdf`, name: "Платный" }],
      link: null,
    },
    {
      id: lid(3),
      title: "Чужой путь",
      text: "т",
      files: [{ path: "other-tenant/x.pdf", name: null }],
      link: null,
      preview: true,
    },
  ],
};

let ctx: TenantContext;
let signedCalls: string[] = [];
let product: { id: string; kind: string } | null = { id: P, kind: "digital" };

vi.mock("@/core/tenant/resolve.server", () => ({
  resolveTenant: async () => ctx.tenant,
  tenantContext: () => ctx,
}));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (key: string) => {
          signedCalls.push(key);
          return { data: { signedUrl: `https://s.test/${key}?token=1` } };
        },
      }),
    },
  }),
}));
vi.mock("@/core/storefront/catalog", () => ({ storeProduct: async () => product }));

const { courseFileResponse } = await import("./course-file.server");

beforeEach(() => {
  signedCalls = [];
  product = { id: P, kind: "digital" };
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  ctx = {
    tenant: {
      id: T,
      archived: false,
      modules: { shop: true, web_storefront: true, courses: true },
      settings: { slug: "school", served_by: "v2" },
    },
    db,
    timezone: "Europe/Moscow",
  } as unknown as TenantContext;
});

describe("файл открытого урока по ссылке", () => {
  it("открытый урок: 302 на свежую подписанную ссылку, подпись ровно по клику", async () => {
    const r = await courseFileResponse("school", P, "1", "0");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain(`https://s.test/${T}/course/free.pdf?token=1`);
    expect(r.headers.get("location")).toContain("download="); // имя файла — «Чек-лист»
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(signedCalls).toEqual([`${T}/course/free.pdf`]);
  });

  it("закрытый урок, чужой путь, нет файла — 404 и без подписи", async () => {
    for (const [no, idx] of [
      ["2", "0"],
      ["3", "0"],
      ["1", "4"],
      ["9", "0"],
    ] as const)
      expect((await courseFileResponse("school", P, no, idx)).status).toBe(404);
    expect(signedCalls).toEqual([]);
  });

  it("мусор в адресе и товар не из каталога — 404", async () => {
    expect((await courseFileResponse("School!", P, "1", "0")).status).toBe(404);
    expect((await courseFileResponse("school", "не-uuid", "1", "0")).status).toBe(404);
    expect((await courseFileResponse("school", P, "1", "-1")).status).toBe(404);
    product = null;
    expect((await courseFileResponse("school", P, "1", "0")).status).toBe(404);
    product = { id: P, kind: "physical" };
    expect((await courseFileResponse("school", P, "1", "0")).status).toBe(404);
    expect(signedCalls).toEqual([]);
  });

  it("клиент прежней платформы (served_by не v2) невидим: 404, подписи нет", async () => {
    (ctx.tenant as { settings: Record<string, unknown> }).settings = { slug: "school" };
    expect((await courseFileResponse("school", P, "1", "0")).status).toBe(404);
    expect(signedCalls).toEqual([]);
  });

  it("лимит запросов: сверх бюджета — 429, подпись не ставится", async () => {
    const { COURSE_FILE_BUDGET } = await import("@/core/storefront/rate-limit");
    // Свой товар: счёт в памяти процесса общий для всех тестов файла.
    const Q = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";
    (ctx.db as unknown as { tables: { app_settings: unknown[] } }).tables.app_settings.push({
      bot_id: T,
      key: courseKey(Q),
      value: JSON.stringify(course),
    });
    for (let i = 0; i < COURSE_FILE_BUDGET.limit; i++)
      expect((await courseFileResponse("school", Q, "1", "0")).status).toBe(302);
    const over = await courseFileResponse("school", Q, "1", "0");
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBe("60");
    expect(signedCalls).toHaveLength(COURSE_FILE_BUDGET.limit);
  });
});
