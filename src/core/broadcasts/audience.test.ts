import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { createBroadcast, resolveAudience, resolveWhatsAppAudience } from "./broadcasts";

const BOT = "00000000-0000-0000-0000-000000000001";
const CONTENT = { photoKeys: [], productIds: [], showCatalog: false };

/**
 * Покупатели трёх каналов в одной таблице bot_users. У Instagram/WhatsApp
 * telegram_id синтетический — бывает и положительным, поэтому отсекать их
 * должен фильтр платформы в запросе, а не только знак id.
 */
function setup() {
  const db = fakeDb();
  db.tables.bot_users = [
    { telegram_id: 101, platform: "telegram", state: { country_code: "KZ" }, opt_out: false },
    { telegram_id: 102, platform: "telegram", state: { country_code: "RU" }, opt_out: false },
    { telegram_id: 103, platform: "telegram", state: null, opt_out: true },
    { telegram_id: null, platform: "telegram", state: null, opt_out: false },
    { telegram_id: -5, platform: "telegram", state: null, opt_out: false },
    // Чужие каналы с положительным синтетическим id — не Telegram-чат.
    {
      telegram_id: 900,
      user_key: "ig:900",
      platform: "instagram",
      state: { country_code: "KZ" },
      opt_out: false,
    },
    {
      telegram_id: 901,
      user_key: "wa:77001112233",
      contact_phone: "+7 700 111 22 33",
      platform: "whatsapp",
      state: { country_code: "KZ" },
      opt_out: false,
    },
    {
      telegram_id: 902,
      user_key: "wa:77004445566",
      contact_phone: "77004445566",
      platform: "whatsapp",
      state: null,
      opt_out: false,
    },
  ];
  db.tables.orders = [
    { telegram_id: 101, platform: "telegram", status: "delivered", user_key: null },
    // Не выдан — ещё не покупатель.
    { telegram_id: 102, platform: "telegram", status: "pending", user_key: null },
    // Заказ из Instagram того же синтетического id — не Telegram-покупатель.
    { telegram_id: 900, platform: "instagram", status: "delivered", user_key: "ig:900" },
    { telegram_id: 901, platform: "whatsapp", status: "delivered", user_key: "wa:77001112233" },
  ];
  db.tables.app_settings = [];
  db.tables.broadcasts = [];
  db.tables.broadcast_recipients = [];
  const ctx = {
    tenant: { id: BOT, ownerTelegramId: null, modules: { wa_broadcasts: true } },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

describe("аудитория рассылки в Telegram", () => {
  it("«все» не отдаёт id покупателей из других каналов, даже положительные", async () => {
    const { ctx } = setup();
    expect((await resolveAudience(ctx, "all")).sort()).toEqual([101, 102]);
  });

  it("фильтр по платформе доезжает до запроса, а не только до результата", async () => {
    const { ctx } = setup();
    const ids = await resolveAudience(ctx, "all");
    // 900/901/902 положительные: без .eq(platform, telegram) они бы прошли.
    expect(ids).not.toContain(900);
    expect(ids).not.toContain(901);
    expect(ids).not.toContain(902);
  });

  it("строка без telegram_id получателем не считается", async () => {
    const { ctx } = setup();
    const ids = await resolveAudience(ctx, "all");
    expect(ids.every((id) => Number.isFinite(id) && id > 0)).toBe(true);
    expect(ids).not.toContain(0);
    expect(ids).toHaveLength(2);
  });

  it("покупатели — только по выданным телеграм-заказам", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "buyers")).toEqual([101]);
  });

  it("«не покупали» исключает покупателей и чужие каналы разом", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "non_buyers")).toEqual([102]);
  });

  it("аудитория по стране тоже не тянет чужие каналы", async () => {
    const { ctx } = setup();
    expect(await resolveAudience(ctx, "country", { country_code: "kz" })).toEqual([101]);
  });
});

describe("аудитория рассылки в WhatsApp", () => {
  it("без списка исключений отдаёт всех подряд", async () => {
    const { ctx } = setup();
    const r = await resolveWhatsAppAudience(ctx, "all");
    expect(r.map((x) => x.phone).sort()).toEqual(["77001112233", "77004445566"]);
  });
});

describe("создание рассылки", () => {
  it("рассылка в другом канале не считается занятой очередью", async () => {
    const { db, ctx } = setup();
    db.tables.broadcasts!.push({ id: "wa-1", bot_id: BOT, status: "sending", channel: "whatsapp" });
    const r = await createBroadcast(ctx, { ...CONTENT, text: "Привет", audience: "all" });
    expect(r.ok).toBe(true);

    // А в том же канале — занята.
    const again = await createBroadcast(ctx, { ...CONTENT, text: "Ещё", audience: "all" });
    expect(again).toMatchObject({ ok: false, reason: "busy" });
  });
});
