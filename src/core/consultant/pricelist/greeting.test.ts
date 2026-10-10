import { describe, expect, it } from "vitest";
import { alreadyGreeted } from "./engine.server";

const now = Date.parse("2026-10-10T07:40:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe("уже здоровались в разговоре (BOVI 10.10)", () => {
  it("бот отвечал пару минут назад — да", () => {
    const recent = [
      { role: "customer" as const, text: "Подскажите цену" },
      { role: "assistant" as const, text: "Здравствуйте. Пришлите скрин." },
    ];
    expect(alreadyGreeted({ recent, last_reply_at: ago(2) }, now)).toBe(true);
  });

  it("первое сообщение, или прошлый разговор больше суток назад — нет", () => {
    expect(alreadyGreeted({}, now)).toBe(false);
    expect(
      alreadyGreeted(
        { recent: [{ role: "assistant", text: "Здравствуйте." }], last_reply_at: ago(25 * 60) },
        now,
      ),
    ).toBe(false);
    expect(
      alreadyGreeted({ recent: [{ role: "customer", text: "Есть?" }], last_reply_at: ago(1) }, now),
    ).toBe(false);
  });
});
