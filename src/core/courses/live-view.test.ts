import { describe, expect, it } from "vitest";
import { liveSchedule, LIVE_LINK_LEAD_MS } from "./live-view";
import type { Cohort } from "./cohort";
import type { Live } from "./live";

/** Расписание эфиров ученика (Ш2): статусы по времени, ссылка только в окне, доступ. */
const TZ = "Asia/Almaty"; // UTC+5
const cohort = (lives: Cohort["lives"]): Cohort => ({
  id: "c1000000-0000-4000-8000-000000000001",
  title: "Октябрь",
  start: "2026-10-05T10:00",
  enrollUntil: null,
  lives,
});
const l = (n: number, at: string, link: string | null = "https://zoom.us/j/1"): Live => ({
  id: `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Эфир ${n}`,
  at,
  link,
});
// 19:00 по Алматы = 14:00 UTC
const LIVE: Live = l(1, "2026-10-10T19:00");
const at = (iso: string) => new Date(iso);
const view = (now: string, expired = false, lives = [LIVE]) =>
  liveSchedule({ cohort: cohort(lives), expired }, TZ, at(now));

describe("эфиры ученика: окно ссылки", () => {
  it("раньше чем за 15 минут — время есть, ссылки нет", () => {
    const v = view("2026-10-10T13:44:59Z")[0]!;
    expect(v).toMatchObject({
      status: "upcoming",
      link: null,
      startsAt: "2026-10-10T14:00:00.000Z",
    });
    expect(JSON.stringify(v)).not.toContain("zoom.us");
  });
  it("за 15 минут до начала ссылка открывается", () => {
    expect(view("2026-10-10T13:45:00Z")[0]).toMatchObject({
      status: "open",
      link: "https://zoom.us/j/1",
    });
    expect(LIVE_LINK_LEAD_MS).toBe(900_000);
  });
  it("идёт — ссылка есть; через 3 часа после начала — «прошёл», ссылки нет", () => {
    expect(view("2026-10-10T15:59:00Z")[0]!.status).toBe("open");
    expect(view("2026-10-10T17:00:00Z")[0]).toMatchObject({ status: "past", link: null });
  });
  it("эфир без ссылки в окне: open, link null", () => {
    expect(view("2026-10-10T14:00:00Z", false, [l(2, "2026-10-10T19:00", null)])[0]).toMatchObject({
      status: "open",
      link: null,
    });
  });
  it("доступ закончился — эфиров не видно; поток без эфиров и курс без потока — пусто", () => {
    expect(view("2026-10-10T13:50:00Z", true)).toEqual([]);
    expect(liveSchedule({ cohort: cohort(undefined), expired: false }, TZ, new Date())).toEqual([]);
    expect(liveSchedule({ cohort: null, expired: false }, TZ, new Date())).toEqual([]);
  });
  it("порядок по началу", () => {
    const out = view("2026-10-01T00:00:00Z", false, [
      l(2, "2026-10-12T10:00"),
      l(1, "2026-10-11T10:00"),
    ]);
    expect(out.map((x) => x.id.slice(-1))).toEqual(["1", "2"]);
  });
  it("запись эфира: до начала не видна, с начала — видна, видео-ссылка получает плеер", () => {
    const rec = "https://youtu.be/dQw4w9WgXcQ";
    const withRec = [{ ...LIVE, recording: rec }];
    const before = view("2026-10-10T13:00:00Z", false, withRec)[0]!;
    expect(before.recording).toBeNull();
    const after = view("2026-10-10T20:00:00Z", false, withRec)[0]!;
    expect(after).toMatchObject({ status: "past", link: null, recording: rec });
    expect(after.recordingEmbed).toMatch(/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//);
    // не видео — просто ссылка без плеера
    const plain = view("2026-10-10T20:00:00Z", false, [
      { ...LIVE, recording: "https://disk.test/f" },
    ])[0]!;
    expect(plain).toMatchObject({ recording: "https://disk.test/f", recordingEmbed: null });
  });
  it("доступ закончился — записи нет в ответе вовсе", () => {
    const out = view("2026-10-10T20:00:00Z", true, [{ ...LIVE, recording: "https://x.test/r" }]);
    expect(JSON.stringify(out)).not.toContain("x.test");
  });
});
