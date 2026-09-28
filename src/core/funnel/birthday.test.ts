import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  birthdayToday,
  fillBirthdayText,
  parseBirthday,
  parseBirthdayConfig,
  runBirthdays,
} from "./birthday";

const BOT = "00000000-0000-0000-0000-0000000000bd";

describe("день рождения покупателя", () => {
  it("дата в любой записи, год необязателен; несуществующей нет", () => {
    expect(parseBirthday("15.03")).toBe("03-15");
    expect(parseBirthday("5/3/1990")).toBe("03-05");
    expect(parseBirthday("03-15")).toBe("03-15");
    expect(parseBirthday("29.02")).toBe("02-29");
    expect(parseBirthday("31.04")).toBeNull();
    expect(parseBirthday("завтра")).toBeNull();
  });

  it("сегодня — в поясе магазина; 29 февраля поздравляем 28-го в невисокосный год", () => {
    expect(birthdayToday("Asia/Almaty", new Date("2026-03-14T20:00:00Z")).days).toEqual(["03-15"]);
    expect(birthdayToday("Asia/Almaty", new Date("2027-02-28T08:00:00Z")).days).toEqual([
      "02-28",
      "02-29",
    ]);
    expect(birthdayToday("Asia/Almaty", new Date("2028-02-28T08:00:00Z")).days).toEqual(["02-28"]);
  });

  it("текст: имя и промокод", () => {
    expect(fillBirthdayText("{name}, с днём рождения! Код {promo}", "Анна", "BDAY10")).toBe(
      "Анна, с днём рождения! Код BDAY10",
    );
    expect(parseBirthdayConfig('{"enabled":true,"text":" Ура ","promo":"bday"}')).toEqual({
      enabled: true,
      text: "Ура",
      promo: "BDAY",
    });
  });

  it("крон поздравляет в день рождения один раз в год, отписавшихся — нет", async () => {
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [
      {
        bot_id: BOT,
        key: "birthday_greeting",
        value: JSON.stringify({ enabled: true, text: "С днём рождения, {name}!", promo: "" }),
      },
    ];
    const u = (key: string, over: Record<string, unknown> = {}) => ({
      bot_id: BOT,
      user_key: key,
      telegram_id: Number(key.slice(3)),
      platform: "telegram",
      first_name: "Анна",
      opt_out: false,
      state: { birthday: "03-15" },
      ...over,
    });
    db.tables.bot_users = [
      u("tg_1"),
      u("tg_2", { opt_out: true }),
      u("tg_3", { state: { birthday: "04-01" } }),
    ];
    db.tables.blocked_users = [];
    const ctx = {
      db,
      tenant: { id: BOT, modules: { funnel: true } },
      timezone: "Asia/Almaty",
    } as unknown as TenantContext;
    const got: string[] = [];
    const send = async (c: { userKey: string }, text: string) => {
      got.push(`${c.userKey}: ${text}`);
      return true;
    };
    const noon = new Date("2026-03-15T06:00:00Z");
    expect(await runBirthdays(ctx, send, noon)).toEqual({ sent: 1, failed: 0 });
    expect(got).toEqual(["tg_1: С днём рождения, Анна!"]);
    expect(await runBirthdays(ctx, send, noon)).toEqual({ sent: 0, failed: 0 });
  });
});
