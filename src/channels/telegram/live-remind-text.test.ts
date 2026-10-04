import { describe, expect, it } from "vitest";
import { liveReminderMessage } from "./live-remind-text";

const base = {
  telegramId: 1,
  course: "Акварель <2>",
  title: "Разбор & итоги",
  at: "2026-10-20T19:05",
  link: "https://zoom.us/j/9",
  url: "https://a.test/s/school/course/item-1?k=x",
};

describe("текст напоминания об эфире", () => {
  it("на языке ученика, время как задано продавцом, HTML экранирован", () => {
    for (const [loc, word] of [
      ["ru", "Через час эфир"],
      ["kk", "эфирге бір сағат қалды"],
      ["en", "starts in an hour"],
      ["uz", "efirga bir soat qoldi"],
    ] as const) {
      const m = liveReminderMessage({ ...base, kind: "hour" }, loc);
      expect(m.text, loc).toContain(word);
      expect(m.text, loc).toMatch(loc === "en" ? /07:05\s?PM/ : /19:05/);
      expect(m.text, loc).toContain("&lt;2&gt;");
      expect(m.text, loc).toContain("&amp;");
    }
  });
  it("за час — кнопка «войти» со ссылкой на эфир; за сутки — ссылки нет", () => {
    const hour = liveReminderMessage({ ...base, kind: "hour" }, "ru");
    expect(hour.rows.flat().map((b) => b.url)).toEqual([base.link, base.url]);
    const day = liveReminderMessage({ ...base, kind: "day", link: null }, "ru");
    expect(day.rows.flat().map((b) => b.url)).toEqual([base.url]);
    expect(JSON.stringify(day)).not.toContain("zoom.us");
  });
  it("за час без ссылки и без адреса витрины — просто текст", () => {
    const m = liveReminderMessage({ ...base, kind: "hour", link: null, url: "" }, "en");
    expect(m.rows).toEqual([]);
  });
  it("«запись готова»: на языке ученика, кнопка ведёт на запись", () => {
    for (const [loc, word] of [
      ["ru", "Запись эфира готова"],
      ["kk", "Эфир жазбасы дайын"],
      ["en", "recording is ready"],
      ["uz", "Efir yozuvi tayyor"],
    ] as const) {
      const m = liveReminderMessage({ ...base, kind: "rec", link: "https://rec.test/1" }, loc);
      expect(m.text, loc).toContain(word);
      expect(
        m.rows.flat().map((b) => b.url),
        loc,
      ).toEqual(["https://rec.test/1", base.url]);
    }
  });
});
