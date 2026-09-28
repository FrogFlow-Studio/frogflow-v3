import { beforeEach, describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  emailKey,
  identityKeys,
  linkedProfiles,
  linkProfiles,
  matchProfiles,
  phoneKey,
  unlinkProfiles,
  type ProfileRow,
} from "./identity";

const BOT = "00000000-0000-0000-0000-0000000000c1";
const p = (over: Partial<ProfileRow> & { user_key: string }): ProfileRow => ({
  telegram_id: 1,
  platform: "telegram",
  username: null,
  first_name: null,
  last_name: null,
  contact_phone: null,
  email: null,
  ...over,
});

describe("признаки личности", () => {
  it("телефон — последние 10 цифр в любой записи, короче — не признак", () => {
    expect(phoneKey("+7 (701) 000-00-00")).toBe("7010000000");
    expect(phoneKey("87010000000")).toBe("7010000000");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it("почта без регистра и пробелов, не почта — не признак", () => {
    expect(emailKey("  Anna@Mail.KZ ")).toBe("anna@mail.kz");
    expect(emailKey("anna")).toBeNull();
  });

  it("номер WhatsApp берётся из ключа профиля", () => {
    expect(identityKeys(p({ user_key: "wa_77010000000" }))).toEqual(["p:7010000000"]);
  });
});

describe("тот же человек в других каналах", () => {
  const self = p({ user_key: "tg_1", contact_phone: "+7 701 000 00 00", email: "a@b.kz" });

  it("по телефону, почте и ручной связи; сам себя не находит; чужие — нет", () => {
    const found = matchProfiles(
      self,
      [
        self,
        p({ user_key: "wa_87010000000", platform: "whatsapp", telegram_id: -5 }),
        p({ user_key: "web_x", platform: "web", email: "A@B.kz", first_name: "Анна" }),
        p({ user_key: "ig_9", platform: "instagram", username: "anna" }),
        p({ user_key: "tg_2", contact_phone: "+7 702 000 00 00" }),
      ],
      new Set(["ig_9"]),
    );
    expect(found.map((f) => [f.userKey, f.reasons])).toEqual([
      ["wa_87010000000", ["phone"]],
      ["web_x", ["email"]],
      ["ig_9", ["manual"]],
    ]);
    expect(found[1]!.name).toBe("Анна");
    expect(found[0]!.telegramId).toBe(-5);
  });
});

describe("ручная связь", () => {
  let db: FakeDb;
  let ctx: TenantContext;
  beforeEach(() => {
    db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [];
    db.tables.bot_users = [
      p({ user_key: "tg_1", contact_phone: "87010000000" }),
      p({ user_key: "ig_9", platform: "instagram", telegram_id: -9 }),
    ].map((r) => ({ ...r, bot_id: BOT }));
    ctx = { db, tenant: { id: BOT } } as unknown as TenantContext;
  });

  it("связь пишется у обоих, видна из обеих карточек и снимается у обоих", async () => {
    expect(await linkProfiles(ctx, "tg_1", "ig_9")).toBe(true);
    const [a, b] = db.tables.bot_users as ProfileRow[];
    expect((await linkedProfiles(ctx, a!)).map((x) => x.userKey)).toEqual(["ig_9"]);
    expect((await linkedProfiles(ctx, b!)).map((x) => x.userKey)).toEqual(["tg_1"]);
    await unlinkProfiles(ctx, "ig_9", "tg_1");
    expect(await linkedProfiles(ctx, a!)).toEqual([]);
  });

  it("с собой и с несуществующим профилем не связывает", async () => {
    expect(await linkProfiles(ctx, "tg_1", "tg_1")).toBe(false);
    expect(await linkProfiles(ctx, "tg_1", "ig_404")).toBe(false);
    expect(db.tables.app_settings).toEqual([]);
  });
});
