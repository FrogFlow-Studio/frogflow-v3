import { describe, expect, it } from "vitest";
import { launchDone, launchHints, launchSteps, liveNoLinkCount } from "./launch";

const done = (i: Parameters<typeof launchSteps>[0]) =>
  launchSteps(i)
    .filter((s) => s.done)
    .map((s) => s.key);

describe("чеклист запуска школы", () => {
  it("пустая школа: ничего не сделано", () => {
    expect(done({ slug: null, courses: [], students: 0 })).toEqual([]);
  });

  it("шаги отмечаются по фактам: адрес, курс, урок, канал, ученик", () => {
    expect(done({ slug: "school", courses: [], students: 0 })).toEqual(["slug"]);
    expect(
      done({ slug: "school", courses: [{ name: "A", lessons: 0, channel: false }], students: 0 }),
    ).toEqual(["slug", "course"]);
    expect(
      done({
        slug: null,
        courses: [
          { name: "A", lessons: 0, channel: true },
          { name: "B", lessons: 2, channel: false },
        ],
        students: 0,
      }),
    ).toEqual(["course", "lessons", "channel"]);
  });

  it("всё пройдено — чеклист закрывается", () => {
    const steps = launchSteps({
      slug: "s",
      courses: [{ name: "A", lessons: 3, channel: true }],
      students: 1,
    });
    expect(launchDone(steps)).toBe(true);
    expect(launchDone(launchSteps({ slug: "s", courses: [], students: 0 }))).toBe(false);
  });

  describe("эфиры без ссылки", () => {
    const NOW = new Date("2026-10-10T10:00:00Z");
    const live = (at: string, link: string | null) => ({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Эфир",
      at,
      link,
    });

    it("считаются только будущие и идущие без ссылки; прошедшие и со ссылкой — нет", () => {
      const cohorts = [
        {
          lives: [
            live("2026-10-15T19:00", null), // впереди, ссылки нет
            live("2026-10-10T15:30", null), // идёт: начался 30 минут назад (пояс +05:00)
            live("2026-10-01T19:00", null), // давно прошёл
            live("2026-10-15T19:00", "https://zoom.us/j/1"), // со ссылкой
          ],
        },
        { lives: [live("2026-11-01T12:00", null)] },
        {},
      ];
      expect(liveNoLinkCount(cohorts, "Asia/Almaty", NOW)).toBe(3);
    });

    it("подсказка появляется, когда такие эфиры есть, и не мешает закрытому чеклисту", () => {
      const course = { name: "A", lessons: 3, channel: true, liveNoLink: 2 };
      const input = { slug: "s", courses: [course, { ...course, liveNoLink: 1 }], students: 1 };
      expect(launchHints(input)).toEqual([{ key: "liveNoLink", n: 3 }]);
      expect(launchDone(launchSteps(input))).toBe(true);
      expect(launchHints({ ...input, courses: [{ ...course, liveNoLink: 0 }] })).toEqual([]);
      expect(launchHints({ slug: null, courses: [], students: 0 })).toEqual([]);
    });
  });
});
