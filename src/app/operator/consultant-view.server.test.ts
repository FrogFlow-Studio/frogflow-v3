import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import { settingsFromJson } from "@/core/tenant/directory";

/** Консультант по прайсу у оператора: модель выбранная и фактическая, цена хода, выбор. */
const BOT = "30000000-0000-0000-0000-000000000001";
let db: FakeDb;
let pricelist = true;
const events: Array<Record<string, unknown>> = [];
vi.mock("@/core/tenant/resolve.server", async (orig) => ({
  ...(await orig<typeof import("@/core/tenant/resolve.server")>()),
  requireTenant: async () => ({
    id: BOT,
    name: "BOVI",
    vertical: "consultant",
    modules: { manager_chat: true },
    settings: settingsFromJson({ consultant_pricelist: { enabled: pricelist } }),
  }),
  tenantContext: (t: { id: string }) => ({ tenant: t, db, timezone: "Asia/Almaty" }),
}));
// Сводка «Обзора» проверена в admin/workspace.server.test.ts.
vi.mock("@/app/admin/workspace.server", () => ({
  consultantOverview: async () => ({ alerts: [] }),
}));
vi.mock("./operator.server", () => ({
  logEvent: async (_id: string, _kind: string, payload: Record<string, unknown>) => {
    events.push(payload);
  },
}));

const { consultantOperatorView, setConsultantModel } = await import("./consultant-view.server");
const NOW = new Date("2026-10-08T12:00:00Z");
const row = (id: string, model: string | null, usd: number, daysAgo = 1) => ({
  id,
  bot_id: BOT,
  model,
  token_usage: { usd },
  received_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
});

beforeEach(() => {
  setEnvForTests({ CONSULTANT_MODEL: "" });
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.consultant_message_runs = [
    row("r1", "claude-sonnet-5", 0.02),
    row("r2", "claude-sonnet-5", 0.04),
    row("r3", null, 0),
    row("r4", "claude-haiku-4-5-20251001", 0.5, 9),
  ];
  pricelist = true;
  events.length = 0;
});

describe("вид консультанта у оператора", () => {
  it("опечатка в настройке видна: отвечает модель платформы", async () => {
    db.tables.app_settings = [
      { bot_id: BOT, key: "consultant_model", value: "claude-sonnet-5-2026" },
      {
        bot_id: BOT,
        key: "consultant_last_error",
        value: "2026-10-08T11:50:00.000Z — HTTP 529: overloaded",
      },
    ];
    const v = (await consultantOperatorView(BOT, NOW))!;
    expect(v.model).toMatchObject({
      stored: "claude-sonnet-5-2026",
      effective: "claude-haiku-4-5",
      unknown: true,
      platform: "claude-haiku-4-5",
    });
    expect(v.model.options).toContain("claude-sonnet-5");
    expect(v.lastError).toEqual({
      at: "2026-10-08T11:50:00.000Z",
      detail: "HTTP 529: overloaded",
      transient: true,
    });
  });

  it("цена хода по моделям за 7 дней, старше недели не считается", async () => {
    const v = (await consultantOperatorView(BOT, NOW))!;
    expect(v.week).toEqual([{ model: "claude-sonnet-5", runs: 2, usd: 0.06, avgUsd: 0.03 }]);
    expect(v.lastError).toBeNull();
  });

  it("журнал не прочитался — ошибка, а не «модель не вызывалась»", async () => {
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const q = from(table);
      if (table === "consultant_message_runs")
        q.range = (() => Promise.resolve({ data: null, error: { message: "timeout" } })) as never;
      return q;
    };
    await expect(consultantOperatorView(BOT, NOW)).rejects.toThrow();
  });

  it("консультант не по прайсу — карточки нет", async () => {
    pricelist = false;
    expect(await consultantOperatorView(BOT, NOW)).toBeNull();
  });
});

describe("выбор модели оператором", () => {
  it("модель из списка записывается и с ней консультант отвечает; журнал", async () => {
    await setConsultantModel(BOT, "claude-sonnet-5", "yakov");
    const v = (await consultantOperatorView(BOT, NOW))!;
    expect(v.model).toMatchObject({ stored: "claude-sonnet-5", effective: "claude-sonnet-5" });
    const { pricelistModel } = await import("@/core/consultant/pricelist/engine.server");
    const ctx = { tenant: { id: BOT }, db } as never;
    expect(await pricelistModel(ctx, "claude-haiku-4-5")).toBe("claude-sonnet-5");
    expect(events).toEqual([{ consultant_model: "claude-sonnet-5" }]);
  });

  it("«модель платформы» стирает выбор", async () => {
    await setConsultantModel(BOT, "claude-sonnet-5");
    await setConsultantModel(BOT, "");
    const v = (await consultantOperatorView(BOT, NOW))!;
    expect(v.model).toMatchObject({ stored: "", effective: "claude-haiku-4-5", unknown: false });
  });

  it("чего нет в проверенном списке — не пишется", async () => {
    await expect(setConsultantModel(BOT, "claude-sonnet-5-2026")).rejects.toThrow(
      "проверенном списке",
    );
    expect(db.tables.app_settings).toEqual([]);
  });

  it("консультант не по прайсу — модель не пишется", async () => {
    pricelist = false;
    await expect(setConsultantModel(BOT, "claude-sonnet-5")).rejects.toThrow();
    expect(db.tables.app_settings).toEqual([]);
  });
});
