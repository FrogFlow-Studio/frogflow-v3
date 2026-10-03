import { describe, expect, it } from "vitest";
import { launchDone, launchSteps } from "./launch";

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
});
