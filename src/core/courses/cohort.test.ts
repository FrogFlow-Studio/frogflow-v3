import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import { fakeDb } from "../../../tests/fake-db";
import {
  cohortForPurchase,
  courseTimeline,
  enrollOpen,
  localToInstant,
  type Cohort,
} from "./cohort";
import { courseKey, courseProblem, parseCourse, type Course } from "./course";

vi.mock("@/config/env", () => ({
  env: () => ({ SECRETS_KEY: "test-secret", APP_URL: "https://www.frogflow.tech" }),
}));

const { announceNewLessons } = await import("./announce.server");
const { parseRun, runKey, startRunAtDelivery } = await import("./run.server");
const { addToCart } = await import("@/core/cart/cart");

/**
 * Потоки и тарифы курса: общий старт, выбор потока по дате покупки, уроки
 * по календарю потока, срок доступа по тарифу, закрытие набора.
 */
const TZ = "Europe/Moscow";
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const V_BASE = "bbbbbbbb-0000-4000-8000-000000000001";
const V_PRO = "bbbbbbbb-0000-4000-8000-000000000002";
const lid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;

const october: Cohort = {
  id: cid(1),
  title: "Октябрь",
  start: "2026-10-15T10:00",
  enrollUntil: "2026-10-20",
};
const november: Cohort = {
  id: cid(2),
  title: "Ноябрь",
  start: "2026-11-15T10:00",
  enrollUntil: null,
};
const course: Course = {
  schedule: { mode: "drip", everyDays: 7 },
  lessons: [1, 2, 3].map((n) => ({
    id: lid(n),
    title: `Урок ${n}`,
    text: "т",
    files: [],
    link: null,
  })),
  cohorts: [november, october],
  tariffs: {
    [V_BASE]: { homework: false, channel: false, accessDays: 30 },
    [V_PRO]: { homework: true, channel: true, accessDays: null },
  },
};

describe("поток и пояс магазина", () => {
  it("старт «15 октября 10:00» по Москве — 07:00 UTC", () => {
    expect(localToInstant("2026-10-15T10:00", TZ).toISOString()).toBe("2026-10-15T07:00:00.000Z");
    expect(localToInstant("2026-10-15T10:00", "Asia/Almaty").toISOString()).toBe(
      "2026-10-15T05:00:00.000Z",
    );
  });

  it("поток выбирается по дате покупки: до конца набора — октябрь, после — ноябрь", () => {
    const bought = (iso: string) => cohortForPurchase(course, new Date(iso), TZ)?.title;
    expect(bought("2026-09-28T12:00:00Z")).toBe("Октябрь");
    // Октябрь уже начался, но набор до 20-го включительно по Москве.
    expect(bought("2026-10-20T20:00:00Z")).toBe("Октябрь");
    expect(bought("2026-10-20T21:30:00Z")).toBe("Ноябрь");
    // Все наборы кончились — в последний поток, а не «никуда».
    expect(bought("2026-12-01T00:00:00Z")).toBe("Ноябрь");
  });

  it("набор открыт, пока идёт хотя бы в один поток; без потоков — всегда", () => {
    expect(enrollOpen(course, new Date("2026-11-01T00:00:00Z"), TZ)).toBe(true);
    expect(enrollOpen(course, new Date("2026-11-15T08:00:00Z"), TZ)).toBe(false);
    expect(enrollOpen({ ...course, cohorts: [] }, new Date("2030-01-01"), TZ)).toBe(true);
  });
});

describe("календарь покупки", () => {
  const tl = (now: string, variantId: string | null = V_PRO, boughtAt = "2026-09-28T12:00:00Z") =>
    courseTimeline({ course, run: null, boughtAt, variantId }, TZ, new Date(now));

  it("до старта потока все уроки закрыты, первый открывается в момент старта", () => {
    const before = tl("2026-10-15T06:59:00Z");
    expect(before.beforeStart).toBe(true);
    expect(before.access.filter((a) => a.open)).toHaveLength(0);
    const after = tl("2026-10-15T07:00:00Z");
    expect(after.cohort?.title).toBe("Октябрь");
    expect(after.access.map((a) => a.open)).toEqual([true, false, false]);
  });

  it("опоздавший в набор видит уже открытые уроки потока", () => {
    const late = tl("2026-10-23T08:00:00Z", V_PRO, "2026-10-20T10:00:00Z");
    expect(late.access.map((a) => a.open)).toEqual([true, true, false]);
  });

  it("тариф: базовый — без ДЗ и канала, доступ 30 дней от старта; без варианта — всё включено", () => {
    const base = tl("2026-10-16T00:00:00Z", V_BASE);
    expect(base.tariff).toEqual({ homework: false, channel: false, accessDays: 30 });
    expect(base.expiresAt).toBe("2026-11-14T07:00:00.000Z");
    const over = tl("2026-11-14T07:00:00Z", V_BASE);
    expect(over.expired).toBe(true);
    expect(over.access.some((a) => a.open)).toBe(false);
    expect(tl("2026-10-16T00:00:00Z", null).tariff).toEqual({
      homework: true,
      channel: true,
      accessDays: null,
    });
  });

  it("поток сохраняется в записи прохождения: перенос старта двигает календарь", () => {
    const moved: Course = {
      ...course,
      cohorts: [{ ...october, start: "2026-10-17T10:00" }, november],
    };
    const x = courseTimeline(
      {
        course: moved,
        run: { startedAt: "2026-09-28T12:00:00Z", cohortId: october.id },
        boughtAt: "2026-09-28T12:00:00Z",
        variantId: null,
      },
      TZ,
      new Date("2026-10-16T12:00:00Z"),
    );
    expect(x.start).toBe("2026-10-17T07:00:00.000Z");
    expect(x.beforeStart).toBe(true);
  });
});

describe("запись курса", () => {
  it("потоки и тарифы читаются и проверяются", () => {
    const c = parseCourse(JSON.stringify(course));
    expect(c.cohorts?.map((k) => k.title)).toEqual(["Ноябрь", "Октябрь"]);
    expect(c.tariffs?.[V_BASE]?.accessDays).toBe(30);
    expect(courseProblem(T, c)).toBeNull();
    expect(courseProblem(T, { ...c, cohorts: [{ ...october, start: "15.10.2026" }] })).toEqual({
      kind: "badCohort",
      cohort: 1,
    });
    expect(
      courseProblem(T, {
        ...c,
        tariffs: { [V_BASE]: { homework: true, channel: true, accessDays: 0 } },
      }),
    ).toEqual({ kind: "badTariff" });
  });
});

function shop(now: string) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [
    {
      id: P,
      is_active: true,
      stock_quantity: null,
      fulfillment_kind: "digital",
      file_url: "frogflow:course",
      product_material_files: [],
    },
  ];
  db.tables.product_variants = [{ id: V_PRO, product_id: P, name: "С проверкой" }];
  db.tables.order_items = [{ id: "item-1", order_id: 7, product_id: P, product_variant_id: V_PRO }];
  db.tables.orders = [
    {
      id: 7,
      created_at: "2026-09-28T12:00:00Z",
      status: "delivered",
      platform: "telegram",
      telegram_id: 555,
    },
  ];
  db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(course) }];
  const ctx = {
    tenant: { id: T, modules: { courses: true }, settings: { slug: "school" } },
    db,
    appUrl: "https://www.frogflow.tech",
    timezone: TZ,
  } as unknown as TenantContext;
  return { ctx, db, now: new Date(now) };
}

describe("поток от выдачи до первого урока", () => {
  it("выдача записывает в поток; в день старта бот сообщает о первом уроке один раз", async () => {
    const { ctx, db, now } = shop("2026-09-28T12:05:00Z");
    await startRunAtDelivery(
      ctx,
      { id: "item-1", order_id: 7, product_id: P, product_variant_id: V_PRO },
      now,
    );
    const run = parseRun(
      (db.tables.app_settings as Array<{ key: string; value: string }>).find(
        (r) => r.key === runKey("item-1"),
      )?.value,
    );
    expect(run).toMatchObject({ cohortId: october.id, notified: 0 });

    const sent: Array<{ lessonNo: number }> = [];
    const send = async (a: { lessonNo: number }) => (sent.push(a), true);
    await announceNewLessons(ctx, send, new Date("2026-10-14T12:00:00Z"));
    expect(sent).toEqual([]);
    await announceNewLessons(ctx, send, new Date("2026-10-15T07:05:00Z"));
    await announceNewLessons(ctx, send, new Date("2026-10-15T08:05:00Z"));
    expect(sent.map((s) => s.lessonNo)).toEqual([1]);
  });

  it("набор закончился во все потоки — курс не кладётся в корзину", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-16T00:00:00Z"), toFake: ["Date"] });
    try {
      const { ctx } = shop("2026-11-16T00:00:00Z");
      const customer = { telegramId: 555, userKey: "tg_555", state: {} } as unknown as Customer;
      expect(await addToCart(ctx, customer, P, V_PRO)).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("набор идёт — курс продаётся", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T00:00:00Z"), toFake: ["Date"] });
    try {
      const { ctx } = shop("2026-10-01T00:00:00Z");
      const customer = { telegramId: 555, userKey: "tg_555", state: {} } as unknown as Customer;
      expect(await addToCart(ctx, customer, P, V_PRO)).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("курс на витрине до покупки", () => {
  it("программа без содержимого уроков, ближайший поток, тарифы; после набора — закрыто", async () => {
    const { coursePreview } = await import("./preview.server");
    const secret: Course = {
      ...course,
      lessons: course.lessons.map((l) => ({ ...l, text: "СЕКРЕТ", link: "https://x.test/v" })),
    };
    const { ctx, db } = shop("2026-10-01T00:00:00Z");
    (db.tables.app_settings as Array<{ key: string; value: string }>)[0]!.value =
      JSON.stringify(secret);
    const open = await coursePreview(ctx, P, new Date("2026-10-01T00:00:00Z"));
    expect(JSON.stringify(open)).not.toContain("СЕКРЕТ");
    expect(JSON.stringify(open)).not.toContain("x.test");
    expect(open).toMatchObject({
      everyDays: 7,
      enrollOpen: true,
      cohort: { title: "Октябрь", start: "2026-10-15T07:00:00.000Z" },
    });
    expect(open?.lessons.map((l) => l.title)).toEqual(["Урок 1", "Урок 2", "Урок 3"]);
    const closed = await coursePreview(ctx, P, new Date("2026-11-20T00:00:00Z"));
    expect(closed).toMatchObject({ enrollOpen: false, cohort: null });
  });
});
