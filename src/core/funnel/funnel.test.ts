import { describe, expect, it } from "vitest";
import { fillFunnelText, funnelDue, parseFunnel } from "./funnel";

const cfg = parseFunnel(
  JSON.stringify({
    enabled: true,
    steps: [
      { afterHours: 72, text: "третий день" },
      { afterHours: 1, text: "{name}, привет", catalogButton: true },
      { afterHours: 24, text: "день спустя" },
      { afterHours: 0, text: "мусор" },
      { afterHours: 5, text: "" },
    ],
  }),
);
const created = "2026-09-20T00:00:00Z";
const at = (h: number) => new Date(Date.parse(created) + h * 3600_000);

describe("автоворонка", () => {
  it("шаги сортируются по времени, мусор отбрасывается", () => {
    expect(cfg.steps.map((s) => s.afterHours)).toEqual([1, 24, 72]);
    expect(cfg.stopOnOrder).toBe(true);
  });
  it("шаг по времени от первого контакта; опоздавшие не шлются пачкой — только последний", () => {
    expect(funnelDue(cfg, created, 0, at(0.5))).toBeNull();
    expect(funnelDue(cfg, created, 0, at(2))).toBe(0);
    expect(funnelDue(cfg, created, 1, at(2))).toBeNull();
    expect(funnelDue(cfg, created, 1, at(30))).toBe(1);
    expect(funnelDue(cfg, created, 0, at(100))).toBe(2);
    expect(funnelDue(cfg, created, 3, at(100))).toBeNull();
  });
  it("подстановка имени", () => {
    expect(fillFunnelText("{name}, привет", "Аня")).toBe("Аня, привет");
    expect(fillFunnelText("{name}!", null)).toBe("Здравствуйте!");
  });
});

describe("автоворонка и отписка", () => {
  it("отписавшемуся от рассылок шаг не уходит", async () => {
    const { fakeDb } = await import("../../../tests/fake-db");
    const { runFunnel, FUNNEL_KEY } = await import("./funnel");
    const db = fakeDb();
    const now = new Date("2026-09-27T08:00:00Z"); // 14:00 в Алматы
    const created = new Date(now.getTime() - 3 * 3600_000).toISOString();
    db.tables.app_settings = [
      {
        key: FUNNEL_KEY,
        value: JSON.stringify({
          enabled: true,
          stopOnOrder: false,
          steps: [{ afterHours: 1, text: "Привет, {name}", catalogButton: false }],
        }),
      },
    ];
    db.tables.blocked_users = [];
    db.tables.bot_users = [
      {
        user_key: "tg:1",
        platform: "telegram",
        telegram_id: 1,
        opt_out: false,
        state: {},
        created_at: created,
      },
      {
        user_key: "tg:2",
        platform: "telegram",
        telegram_id: 2,
        opt_out: true,
        state: {},
        created_at: created,
      },
    ];
    const ctx = {
      tenant: { id: "b", modules: { funnel: true, blocked: true }, settings: {} },
      db,
      timezone: "Asia/Almaty",
    } as never;
    const sentTo: number[] = [];
    const r = await runFunnel(
      ctx,
      async (c) => {
        sentTo.push(c.telegramId);
        return true;
      },
      now,
    );
    expect(sentTo).toEqual([1]);
    expect(r.sent).toBe(1);
  });
});
