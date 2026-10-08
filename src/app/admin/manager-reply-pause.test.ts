import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";

let customer: { telegramId: number; userKey?: string } | null = null;
const paused: number[] = [];
vi.mock("@/core/customers/customers", () => ({
  getCustomerByTelegramId: async () => customer,
}));
vi.mock("@/core/consultant/engine.server", () => ({
  pauseConsultant: async (_ctx: unknown, c: { telegramId: number }) => {
    paused.push(c.telegramId);
  },
}));

const { pauseBotAfterManagerReply } = await import("./admin.server");
const ctx = { tenant: { id: "bot", settings: {} } } as unknown as TenantContext;

beforeEach(() => {
  paused.length = 0;
  customer = { telegramId: 7 };
});

describe("ответ продавца из «Чата» ставит бота на паузу", () => {
  it("консультант этого покупателя замолкает", async () => {
    await pauseBotAfterManagerReply(ctx, 7);
    expect(paused).toEqual([7]);
  });

  it("покупателя нет в базе — ничего не делаем", async () => {
    customer = null;
    await pauseBotAfterManagerReply(ctx, 7);
    expect(paused).toEqual([]);
  });
});

describe("ответ продавца из «Чата» закрывает задачи консультанта (партия 3.1)", () => {
  it("открытая задача этого покупателя — сделана, отметка «панель»", async () => {
    const { fakeDb } = await import("../../../tests/fake-db");
    const { settingsFromJson } = await import("@/core/tenant/directory");
    const { addTask, TASKS_KEY } = await import("@/core/consultant/tasks");
    const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
    db.tables.app_settings = [];
    const bovi = {
      tenant: {
        id: "bot",
        settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
        modules: {},
      },
      db,
    } as unknown as TenantContext;
    await addTask(bovi, { userKey: "ig:7", reason: "purchase", text: "Берёт" });
    await addTask(bovi, { userKey: "ig:8", reason: "purchase", text: "Другой" });
    customer = { telegramId: 7, userKey: "ig:7" };
    await pauseBotAfterManagerReply(bovi, 7);
    const list = JSON.parse(
      String(db.tables.app_settings.find((r) => r.key === TASKS_KEY)!.value),
    ) as Array<{ userKey: string; done: boolean; doneVia?: string }>;
    expect(list.find((t) => t.userKey === "ig:7")).toMatchObject({ done: true, doneVia: "panel" });
    expect(list.find((t) => t.userKey === "ig:8")).toMatchObject({ done: false });
    expect(paused).toEqual([7]);
  });
});
