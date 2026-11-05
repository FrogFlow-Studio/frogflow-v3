import { describe, expect, it } from "vitest";
import { courseSeen, keepBotAdditions } from "./lesson-by-bot";

const l = (id: string, tgVideos?: string[]) => ({
  id,
  title: id,
  ...(tgVideos ? { tgVideos } : {}),
});

describe("сохранение из панели поверх уроков из бота (03.11.2026, Lash Academy)", () => {
  it("видео и урок, присланные боту, пока карточка была открыта, не пропадают", () => {
    const opened = { lessons: [l("a"), l("b", ["v1"])] };
    const seen = courseSeen(opened);
    // Пока страница открыта: бот добавил видео в урок a и новый урок c.
    const stored = { lessons: [l("a", ["v2"]), l("b", ["v1"]), l("c", ["v3"])] };
    // Продавец поправил название урока b и сохранил свою (старую) копию.
    const incoming = { lessons: [l("a"), { ...l("b", ["v1"]), title: "B" }] };
    expect(keepBotAdditions(stored, incoming, seen).lessons).toEqual([
      l("a", ["v2"]),
      { ...l("b", ["v1"]), title: "B" },
      l("c", ["v3"]),
    ]);
  });

  it("то, что продавец видел и удалил, остаётся удалённым", () => {
    const opened = { lessons: [l("a", ["v1", "v2"]), l("b")] };
    const seen = courseSeen(opened);
    const incoming = { lessons: [l("a", ["v2"])] };
    expect(keepBotAdditions(opened, incoming, seen).lessons).toEqual([l("a", ["v2"])]);
  });
});
