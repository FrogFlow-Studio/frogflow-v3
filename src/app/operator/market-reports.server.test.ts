import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { settingsFromJson } from "@/core/tenant/directory";
import type { Tenant } from "@/core/tenant/types";

let db: FakeDb;
let tenants: Tenant[];
const hidden: Array<{ botId: string; reason: string; actor: string }> = [];
const events: Array<Record<string, unknown>> = [];
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantDirectory: async () => tenants,
  resolveTenant: async () => null,
  tenantContext: () => ({ db }),
}));
// Настоящее скрытие меняет настройки клиента; здесь — тот же эффект на справочнике арендаторов.
vi.mock("./operator.server", () => ({
  setMarketplaceHidden: async (botId: string, on: boolean, reason: string, actor: string) => {
    hidden.push({ botId, reason, actor });
    tenants = tenants.map((t) =>
      t.id === botId
        ? ({
            ...t,
            settings: { ...t.settings, marketplace: { ...t.settings.marketplace, hidden: on } },
          } as Tenant)
        : t,
    );
  },
  logEvent: async (_id: string, _k: string, p: Record<string, unknown>) => void events.push(p),
}));

const { marketReportsView, resolveMarketReport } = await import("./market-reports.server");
const { shownShopIds } = await import("@/core/marketplace/shops.server");

const tenant = (id: string) =>
  ({
    id,
    name: `Магазин ${id}`,
    vertical: "shop",
    settings: settingsFromJson({
      served_by: "v2",
      slug: id,
      marketplace: { listed: true, approved: true },
    }),
  }) as unknown as Tenant;

const log = (id: string, bot: string, over: Record<string, unknown> = {}) => ({
  id,
  bot_id: bot,
  event_type: "market.report",
  status: "open",
  created_at: "2026-10-04T10:00:00Z",
  payload: { slug: bot, shop: `Магазин ${bot}`, reason: "fraud", text: "Обман", reporter: "r" },
  ...over,
});
const ID1 = "11111111-1111-1111-1111-111111111111";
const ID2 = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  db = fakeDb();
  tenants = [tenant("a"), tenant("b")];
  hidden.length = 0;
  events.length = 0;
  db.tables.zernio_logs = [log(ID1, "a"), log(ID2, "b")];
});

describe("жалобы на магазины у оператора", () => {
  it("список показывает причину по-русски и состояние магазина на площадке", async () => {
    const v = await marketReportsView();
    expect(v.total).toBe(2);
    expect(v.reports.map((r) => [r.botId, r.reasonLabel, r.state])).toEqual([
      ["b", "мошенничество или обман", "visible"],
      ["a", "мошенничество или обман", "visible"],
    ]);
  });

  it("«скрыть»: магазин уходит с площадки, жалоба закрыта с решением, прочие магазины на месте", async () => {
    expect([...shownShopIds(tenants)].sort()).toEqual(["a", "b"]);
    expect(await resolveMarketReport(ID1, "hide", "op")).toEqual({ status: "done" });
    expect(hidden).toEqual([
      { botId: "a", reason: "Жалоба: мошенничество или обман. Обман", actor: "op" },
    ]);
    expect([...shownShopIds(tenants)]).toEqual(["b"]);
    const row = db.tables.zernio_logs!.find((r) => r.id === ID1)!;
    expect(row).toMatchObject({ status: "closed", payload: { resolution: "hidden" } });
    const v = await marketReportsView();
    expect(v.reports.map((r) => r.botId)).toEqual(["b"]);
  });

  it("двойной щелчок: магазин скрыт, жалоба закрыта один раз", async () => {
    const r = await Promise.all([
      resolveMarketReport(ID1, "hide", "op"),
      resolveMarketReport(ID1, "hide", "op"),
    ]);
    expect(r.filter((x) => x.status === "done")).toHaveLength(1);
    expect([...shownShopIds(tenants)]).toEqual(["b"]);
  });

  it("«отклонить»: магазин остаётся, в журнал клиента — событие", async () => {
    expect(await resolveMarketReport(ID2, "dismiss", "op")).toEqual({ status: "done" });
    expect(hidden).toEqual([]);
    expect([...shownShopIds(tenants)].sort()).toEqual(["a", "b"]);
    expect(events).toEqual([{ market_report: ID2, resolution: "dismissed" }]);
    expect(db.tables.zernio_logs!.find((r) => r.id === ID2)).toMatchObject({
      status: "closed",
      payload: { resolution: "dismissed" },
    });
  });

  it("закрытой или чужой строки жалобы нет — «уже», ничего не скрыто", async () => {
    db.tables.zernio_logs!.push(
      log("33333333-3333-3333-3333-333333333333", "a", { status: "closed" }),
      {
        id: "44444444-4444-4444-4444-444444444444",
        bot_id: "a",
        event_type: "ticket",
        status: "open",
      },
    );
    expect(await resolveMarketReport("33333333-3333-3333-3333-333333333333", "hide")).toEqual({
      status: "already",
    });
    expect(await resolveMarketReport("44444444-4444-4444-4444-444444444444", "hide")).toEqual({
      status: "already",
    });
    expect(hidden).toEqual([]);
  });
});
