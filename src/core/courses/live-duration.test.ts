import { describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { fakeDb } from "../../../tests/fake-db";
import { courseKey, parseCourse } from "./course";
import { liveNoLinkCount } from "./launch";
import {
  LIVE_DURATION_MAX,
  LIVE_DURATION_MIN,
  liveDurationMs,
  liveProblem,
  parseLives,
  type Live,
} from "./live";
import { saveLive } from "./lives.server";
import { liveSchedule } from "./live-view";
import type { Cohort } from "./cohort";

/** Длительность эфира (Ш3, партия 13): ссылка и «идёт» не пропадают через 3 часа у длинного эфира. */
const TZ = "Europe/Moscow"; // UTC+3: 10:00 по Москве = 07:00 UTC
const C1 = "c1000000-0000-4000-8000-000000000001";
const ID = "e0000000-0000-4000-8000-000000000001";
const P = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const T = "11111111-2222-3333-4444-555555555555";
const live = (over: Partial<Live> = {}): Live => ({
  id: ID,
  title: "Интенсив",
  at: "2026-10-10T10:00",
  link: "https://zoom.us/j/1",
  ...over,
});
const view = (l: Live, now: string) =>
  liveSchedule(
    {
      cohort: {
        id: C1,
        title: "Октябрь",
        start: "2026-10-05T10:00",
        enrollUntil: null,
        lives: [l],
      } as Cohort,
      expired: false,
    },
    TZ,
    new Date(now),
  )[0]!;

describe("длительность эфира", () => {
  it("интенсив 10:00 на 6 часов: в 13:05 идёт и ссылка на месте; без длительности — «прошёл» (3 ч)", () => {
    const now = "2026-10-10T10:05:00Z"; // 13:05 по Москве
    expect(view(live({ durationMin: 360 }), now)).toMatchObject({
      status: "open",
      link: "https://zoom.us/j/1",
    });
    expect(view(live(), now)).toMatchObject({ status: "past", link: null });
  });

  it("окно закрывается ровно по длительности", () => {
    const l = live({ durationMin: 90 });
    expect(view(l, "2026-10-10T08:29:59Z").status).toBe("open");
    expect(view(l, "2026-10-10T08:30:00Z").status).toBe("past");
  });

  it("по умолчанию 3 часа, длительность — минуты", () => {
    expect(liveDurationMs({})).toBe(180 * 60_000);
    expect(liveDurationMs({ durationMin: 45 })).toBe(45 * 60_000);
  });

  it("разбор: длительность в пределах хранится, вне пределов и нецелая — отбрасывается", () => {
    const parse = (d: unknown) => parseLives([{ ...live(), durationMin: d }])[0]!;
    expect(parse(360).durationMin).toBe(360);
    expect(parse(LIVE_DURATION_MIN - 1).durationMin).toBeUndefined();
    expect(parse(LIVE_DURATION_MAX + 1).durationMin).toBeUndefined();
    expect(parse(90.5).durationMin).toBeUndefined();
    expect(parse("120").durationMin).toBeUndefined();
  });

  it("проверка перед записью: вне пределов — badDuration, без длительности — можно", () => {
    expect(liveProblem(live())).toBeNull();
    expect(liveProblem(live({ durationMin: 60 }))).toBeNull();
    expect(liveProblem(live({ durationMin: 5 }))).toBe("badDuration");
    expect(liveProblem(live({ durationMin: 721 }))).toBe("badDuration");
  });

  it("эфир без ссылки считается «не закончившимся» по длительности", () => {
    const k = (l: Live) => [{ lives: [l] }];
    const now = new Date("2026-10-10T11:00:00Z"); // 14:00 по Москве, через 4 часа после начала
    expect(liveNoLinkCount(k(live({ link: null })), TZ, now)).toBe(0);
    expect(liveNoLinkCount(k(live({ link: null, durationMin: 360 })), TZ, now)).toBe(1);
  });

  it("сохранение: длительность записывается в запись курса, плохая — отказ", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [
      {
        bot_id: T,
        key: courseKey(P),
        value: JSON.stringify({
          schedule: { mode: "all" },
          lessons: [],
          cohorts: [{ id: C1, title: "Октябрь", start: "2026-10-05T10:00" }],
        }),
      },
    ];
    const ctx = {
      tenant: { id: T, modules: { courses: true }, settings: { slug: "s" } },
      db,
    } as unknown as TenantContext;
    await saveLive(ctx, P, C1, live({ durationMin: 360 }));
    const row = (db.tables.app_settings as Array<{ key: string; value: string }>)[0]!;
    expect(parseCourse(row.value).cohorts![0]!.lives![0]!.durationMin).toBe(360);
    await expect(saveLive(ctx, P, C1, live({ durationMin: 5 }))).rejects.toMatchObject({
      key: "err.live.badDuration",
    });
  });
});
