import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, parseCourse, type Course } from "./course";
import { saveCourse } from "./course.server";
import { isLocalStart, LIVES_MAX, parseLives, upsertLive, type Live } from "./live";
import { deleteLive, saveLive } from "./lives.server";

/** Эфиры потока в админке (Ш1): разбор, правка, условная запись, гонки. */
const T = "11111111-2222-3333-4444-555555555555";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";
const lid = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const live = (n: number, over: Partial<Live> = {}): Live => ({
  id: lid(n),
  title: `Эфир ${n}`,
  at: `2026-10-${String(10 + n).padStart(2, "0")}T19:00`,
  link: "https://zoom.us/j/1",
  ...over,
});

describe("эфиры: разбор и правка списка", () => {
  it("битые пропускаются, ссылка не https — без ссылки, порядок по началу", () => {
    const out = parseLives([
      live(3),
      { ...live(1), link: "http://zoom.us/j/1" },
      { ...live(2), at: "2026-02-31T10:00" },
      { ...live(4), title: "" },
      live(3),
      "мусор",
    ]);
    expect(out.map((l) => l.id)).toEqual([lid(1), lid(3)]);
    expect(out[0]!.link).toBeNull();
    expect(isLocalStart("2026-10-15T19:00")).toBe(true);
    expect(isLocalStart("2026-10-15T25:00")).toBe(false);
  });

  it("тот же id — замена, новый — добавление, не больше LIVES_MAX", () => {
    const one = upsertLive([], live(1));
    expect(upsertLive(one as Live[], live(1, { title: "Новое" }))).toEqual([
      live(1, { title: "Новое" }),
    ]);
    const full = Array.from({ length: LIVES_MAX }, (_, i) => live(i + 1));
    expect(upsertLive(full, live(99))).toBe("tooMany");
  });
});

describe("запись эфира (Ш4)", () => {
  it("ссылка на запись разбирается: не https — без неё, https — сохраняется", () => {
    const out = parseLives([
      live(1, { recording: "https://youtu.be/dQw4w9WgXcQ" } as Partial<Live>),
      live(2, { recording: "http://x.test/v" } as Partial<Live>),
    ]);
    expect(out[0]!.recording).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(out[1]!.recording).toBeUndefined();
  });
});

describe("эфиры: запись курса", () => {
  const raw = {
    schedule: { mode: "all" },
    lessons: [{ id: lid(900), title: "Урок", text: "т", files: [], link: null }],
    cohorts: [
      { id: C1, title: "Октябрь", start: "2026-10-10T10:00", enrollUntil: null },
      { id: C2, title: "Ноябрь", start: "2026-11-10T10:00", enrollUntil: null },
    ],
    futureField: { keep: true },
  };
  function shop() {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [{ bot_id: T, key: courseKey(P), value: JSON.stringify(raw) }];
    db.tables.products = [{ id: P, fulfillment_kind: "digital", file_url: "course://lessons" }];
    db.tables.product_variants = [];
    const ctx = {
      tenant: { id: T, modules: { courses: true }, settings: {} },
      db,
      timezone: "Asia/Almaty",
    } as unknown as TenantContext;
    return { ctx, db };
  }
  const stored = (db: ReturnType<typeof fakeDb>) =>
    (db.tables.app_settings as Array<{ key: string; value: string }>).find(
      (r) => r.key === courseKey(P),
    )!.value;
  const lives = (db: ReturnType<typeof fakeDb>, cohort: string) =>
    parseCourse(stored(db)).cohorts?.find((c) => c.id === cohort)?.lives ?? [];

  it("эфир добавляется в свой поток, остальное в записи курса не теряется", async () => {
    const { ctx, db } = shop();
    const out = await saveLive(ctx, P, C1, live(1, { title: "  Разбор ДЗ  " }));
    expect(out).toEqual([live(1, { title: "Разбор ДЗ" })]);
    expect(lives(db, C1)).toEqual(out);
    expect(lives(db, C2)).toEqual([]);
    const obj = JSON.parse(stored(db)) as typeof raw;
    expect(obj.futureField).toEqual({ keep: true });
    expect(obj.lessons).toEqual(raw.lessons);
  });

  it("правка и удаление по id", async () => {
    const { ctx, db } = shop();
    await saveLive(ctx, P, C1, live(1));
    await saveLive(ctx, P, C1, live(2));
    await saveLive(ctx, P, C1, live(1, { link: null, at: "2026-10-20T18:00" }));
    expect(lives(db, C1).map((l) => [l.id, l.at, l.link])).toEqual([
      [lid(2), "2026-10-12T19:00", "https://zoom.us/j/1"],
      [lid(1), "2026-10-20T18:00", null],
    ]);
    expect(await deleteLive(ctx, P, C1, lid(2))).toEqual([
      live(1, { link: null, at: "2026-10-20T18:00" }),
    ]);
    expect(lives(db, C1)).toHaveLength(1);
  });

  it("отказы: нет названия, плохое время, не https, нет потока, больше 30", async () => {
    const { ctx, db } = shop();
    await expect(saveLive(ctx, P, C1, live(1, { title: "  " }))).rejects.toMatchObject({
      key: "err.live.noTitle",
    });
    await expect(saveLive(ctx, P, C1, live(1, { at: "2026-02-30T10:00" }))).rejects.toMatchObject({
      key: "err.live.badTime",
    });
    await expect(
      saveLive(ctx, P, C1, live(1, { link: "http://zoom.us/j/1" })),
    ).rejects.toMatchObject({ key: "err.live.badLink" });
    await expect(saveLive(ctx, P, lid(77), live(1))).rejects.toMatchObject({
      key: "err.live.noCohort",
    });
    for (let i = 1; i <= LIVES_MAX; i++)
      await saveLive(ctx, P, C1, live(i, { at: "2026-10-20T10:00" }));
    await expect(saveLive(ctx, P, C1, live(99, { at: "2026-10-21T10:00" }))).rejects.toMatchObject({
      key: "err.live.tooMany",
    });
    expect(lives(db, C1)).toHaveLength(LIVES_MAX);
  });

  it("запись эфира сохраняется, не https — отказ; правка эфира запись не теряет", async () => {
    const { ctx, db } = shop();
    await saveLive(ctx, P, C1, live(1));
    await expect(
      saveLive(ctx, P, C1, live(1, { recording: "http://rec.test/1" })),
    ).rejects.toMatchObject({ key: "err.live.badRecording" });
    await saveLive(
      ctx,
      P,
      C1,
      live(1, { recording: " https://rutube.ru/video/" + "a".repeat(32) + "/ " }),
    );
    expect(lives(db, C1)[0]!.recording).toBe("https://rutube.ru/video/" + "a".repeat(32) + "/");
    // «Сохранить курс» из формы эфиры (и записи) не стирает
    const form = parseCourse(stored(db));
    await saveCourse(ctx, P, { ...form, cohorts: form.cohorts!.map((c) => ({ ...c, lives: [] })) });
    expect(lives(db, C1)[0]!.recording).toContain("rutube.ru");
  });

  it("двойной клик «Добавить эфир»: один эфир", async () => {
    const { ctx, db } = shop();
    const r = await Promise.allSettled([
      saveLive(ctx, P, C1, live(1)),
      saveLive(ctx, P, C1, live(1)),
    ]);
    expect(r.map((x) => x.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(lives(db, C1)).toEqual([live(1)]);
  });

  it("два разных эфира одновременно: оба записаны, ни один не потерян", async () => {
    const { ctx, db } = shop();
    await Promise.all([
      saveLive(ctx, P, C1, live(1)),
      saveLive(ctx, P, C1, live(2)),
      saveLive(ctx, P, C2, live(3)),
    ]);
    expect(lives(db, C1).map((l) => l.id)).toEqual([lid(1), lid(2)]);
    expect(lives(db, C2).map((l) => l.id)).toEqual([lid(3)]);
  });

  it("«Сохранить» курса из старой формы не стирает эфиры, записанные после её открытия", async () => {
    const { ctx, db } = shop();
    const form = parseCourse(JSON.stringify(raw)); // форма открыта до эфиров
    await saveLive(ctx, P, C1, live(1));
    const edited: Course = {
      ...form,
      cohorts: form.cohorts!.map((c) => ({ ...c, title: `${c.title}!`, lives: [] })),
    };
    await Promise.all([saveCourse(ctx, P, edited), saveLive(ctx, P, C2, live(2))]);
    expect(lives(db, C1)).toEqual([live(1)]);
    expect(lives(db, C2)).toEqual([live(2)]);
    expect(parseCourse(stored(db)).cohorts?.map((c) => c.title)).toEqual(["Октябрь!", "Ноябрь!"]);
  });

  it("поток удалён в форме — его эфиры уходят вместе с ним", async () => {
    const { ctx, db } = shop();
    await saveLive(ctx, P, C2, live(1));
    const form = parseCourse(stored(db));
    await saveCourse(ctx, P, { ...form, cohorts: form.cohorts!.filter((c) => c.id === C1) });
    expect(parseCourse(stored(db)).cohorts?.map((c) => c.id)).toEqual([C1]);
    expect(stored(db)).not.toContain(lid(1));
  });
});
