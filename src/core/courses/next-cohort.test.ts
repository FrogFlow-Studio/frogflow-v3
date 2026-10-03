import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { cohortStart, nextCohortAfter, nextCohortTitle, shiftDay, type Cohort } from "./cohort";
import { courseKey, parseCourse } from "./course";
import { createNextCohort } from "./course.server";

/** «Создать следующий поток» (А27): копия последнего потока со сдвигом дат. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const cid = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEW = "dddddddd-0000-4000-8000-000000000001";

const oct: Cohort = {
  id: cid(1),
  title: "Поток 1",
  start: "2026-10-15T10:00",
  enrollUntil: "2026-10-20",
  chat: "-1001234567890",
};

describe("сдвиг дат следующего потока", () => {
  it("день сдвигается через конец месяца и года, високосный февраль", () => {
    expect(shiftDay("2026-10-20", 20)).toBe("2026-11-09");
    expect(shiftDay("2026-12-25", 10)).toBe("2027-01-04");
    expect(shiftDay("2028-02-27", 3)).toBe("2028-03-01");
    expect(shiftDay("2027-02-27", 2)).toBe("2027-03-01");
  });

  it("старт — на выбранный день с тем же временем, набор — на столько же суток", () => {
    const r = nextCohortAfter([oct], "2026-12-20", "Asia/Almaty", NEW);
    expect(r).toEqual({
      ok: true,
      cohort: { id: NEW, title: "Поток 2", start: "2026-12-20T10:00", enrollUntil: "2026-12-25" },
    });
    // Через границу года: старт в январе — набор тоже в январе.
    const y = nextCohortAfter(
      [{ ...oct, start: "2026-12-10T09:30", enrollUntil: "2026-12-28" }],
      "2027-01-05",
      "Asia/Almaty",
      NEW,
    );
    expect(y).toMatchObject({
      ok: true,
      cohort: { start: "2027-01-05T09:30", enrollUntil: "2027-01-23" },
    });
  });

  it("в поясе магазина: момент старта нового потока — то же местное время, в любом поясе", () => {
    for (const tz of ["Asia/Almaty", "Europe/Moscow", "Pacific/Auckland", "America/New_York"]) {
      const r = nextCohortAfter([oct], "2026-11-01", tz, NEW);
      if (!r.ok) throw new Error("ожидали поток");
      expect(r.cohort.start).toBe("2026-11-01T10:00");
      // 10:00 местного; в Нью-Йорке 1 ноября уже зимнее время — часы переведены.
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(cohortStart(r.cohort, tz));
      expect(local).toBe("10:00");
    }
  });

  it("последний — по дате старта, а не по порядку в списке; без конца набора — без конца", () => {
    const later: Cohort = {
      ...oct,
      id: cid(2),
      title: "Весна",
      start: "2027-03-01T18:00",
      enrollUntil: null,
    };
    const r = nextCohortAfter([later, oct], "2027-09-01", "Asia/Almaty", NEW);
    expect(r).toMatchObject({
      ok: true,
      cohort: { title: "Весна 2", start: "2027-09-01T18:00", enrollUntil: null },
    });
  });

  it("чат потока не копируется; названия с номером и без повторов", () => {
    const r = nextCohortAfter([oct], "2026-11-20", "Asia/Almaty", NEW);
    expect(r.ok && "chat" in r.cohort).toBe(false);
    expect(nextCohortTitle("Поток 9", ["Поток 9"])).toBe("Поток 10");
    expect(nextCohortTitle("Поток 1", ["Поток 1", "Поток 2"])).toBe("Поток 3");
    expect(nextCohortTitle("Октябрь", [])).toBe("Октябрь 2");
    expect(nextCohortTitle("", [])).toBe("2");
  });

  it("отказы: нет потоков, плохой день, не позже последнего, слишком много", () => {
    expect(nextCohortAfter([], "2026-11-01", "Asia/Almaty", NEW)).toEqual({
      ok: false,
      reason: "noCohorts",
    });
    expect(nextCohortAfter([oct], "завтра", "Asia/Almaty", NEW)).toEqual({
      ok: false,
      reason: "badDay",
    });
    expect(nextCohortAfter([oct], "2026-13-45", "Asia/Almaty", NEW)).toEqual({
      ok: false,
      reason: "badDay",
    });
    expect(nextCohortAfter([oct], "2026-02-31", "Asia/Almaty", NEW)).toEqual({
      ok: false,
      reason: "badDay",
    });
    for (const day of ["2026-10-15", "2026-09-01"])
      expect(nextCohortAfter([oct], day, "Asia/Almaty", NEW)).toEqual({
        ok: false,
        reason: "notLater",
      });
    const many = Array.from({ length: 20 }, (_, i) => ({ ...oct, id: cid(i + 1) }));
    expect(nextCohortAfter(many, "2030-01-01", "Asia/Almaty", NEW)).toEqual({
      ok: false,
      reason: "tooMany",
    });
  });
});

describe("запись следующего потока в курс", () => {
  const raw = {
    schedule: { mode: "all" },
    lessons: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Урок",
        text: "т",
        files: [],
        link: null,
        новоеПоле: "не теряется",
      },
    ],
    cohorts: [oct],
    futureField: { keep: true },
  };
  function shop() {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(raw) }];
    const ctx = {
      tenant: { id: T, modules: { courses: true }, settings: {} },
      db,
      timezone: "Asia/Almaty",
    } as unknown as TenantContext;
    return { ctx, db };
  }
  const saved = (db: ReturnType<typeof fakeDb>) =>
    JSON.parse(
      String((db.tables.app_settings as Array<{ key: string; value: string }>)[0]!.value),
    ) as typeof raw;

  it("поток добавляется, остальная запись курса не теряется", async () => {
    const { ctx, db } = shop();
    const made = await createNextCohort(ctx, P, "2026-12-20");
    expect(made).toMatchObject({ title: "Поток 2", start: "2026-12-20T10:00" });
    const after = saved(db);
    expect(after.cohorts).toHaveLength(2);
    expect(after.cohorts[0]).toEqual(oct);
    expect(after.futureField).toEqual({ keep: true });
    expect(after.lessons[0]).toMatchObject({ новоеПоле: "не теряется" });
    expect(parseCourse(JSON.stringify(after)).cohorts?.map((c) => c.title)).toEqual([
      "Поток 1",
      "Поток 2",
    ]);
  });

  it("двойной клик: на тот же день создаётся один поток, второй получает отказ", async () => {
    const { ctx, db } = shop();
    const results = await Promise.allSettled([
      createNextCohort(ctx, P, "2026-12-20"),
      createNextCohort(ctx, P, "2026-12-20"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(saved(db).cohorts).toHaveLength(2);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason.message ?? rejected.reason)).toContain("позже");
  });

  it("ученики и прохождения не трогаются", async () => {
    const { ctx, db } = shop();
    (db.tables.app_settings as Array<Record<string, unknown>>).push({
      bot_id: T,
      key: "course_run_x",
      value: '{"startedAt":"2026-10-15T10:00:00Z","done":[]}',
    });
    await createNextCohort(ctx, P, "2026-12-20");
    expect(
      (db.tables.app_settings as Array<{ key: string; value: string }>).find(
        (r) => r.key === "course_run_x",
      )!.value,
    ).toBe('{"startedAt":"2026-10-15T10:00:00Z","done":[]}');
  });
});
