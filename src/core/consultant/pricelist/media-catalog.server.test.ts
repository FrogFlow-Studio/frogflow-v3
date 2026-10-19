import { describe, expect, it, vi } from "vitest";
import {
  parseMediaDemands,
  loadMediaDemandMap,
  openMediaDemandsCount,
  MEDIA_DEMANDS_KEY,
  TASKS_KEY,
} from "./media-catalog.server";
import { PRODUCT_MEDIA_KEY } from "./media";
import type { TenantContext } from "@/core/tenant/resolve.server";
import * as settingsModule from "@/core/settings/settings";

function mockCtx(): TenantContext {
  return {
    tenant: {
      id: "bot_123",
      status: "active",
      settings: {},
    },
    timezone: "Asia/Almaty",
    botUser: null,
  } as unknown as TenantContext;
}

describe("каталог фото и видео консультанта", () => {
  it("parseMediaDemands парсит пустые и заполненные данные", () => {
    expect(parseMediaDemands(null)).toEqual({});
    expect(parseMediaDemands("")).toEqual({});
    expect(parseMediaDemands("invalid json")).toEqual({});

    const raw = {
      "BOVI КПБ Classic Hotel": {
        model: "BOVI КПБ Classic Hotel",
        count: 3,
        lastRequestedAt: "2026-10-18T10:00:00Z",
        requests: [{ at: "2026-10-18T10:00:00Z", contact: "@yana", text: "фото" }],
      },
    };
    const parsed = parseMediaDemands(JSON.stringify(raw));
    expect(parsed["BOVI КПБ Classic Hotel"]?.count).toBe(3);
    expect(parsed["BOVI КПБ Classic Hotel"]?.requests).toHaveLength(1);
  });

  it("loadMediaDemandMap находит запросы из consultant_tasks_json", async () => {
    const tasks = [
      {
        reason: "photo",
        text: "Покупатель просит фото одеяла Traumina Cube",
        products: ["Traumina Cube Silk (155х215)"],
        at: "2026-10-17T12:00:00Z",
        contact: "@client1",
      },
      {
        reason: "purchase",
        text: "Оформление заказа",
        at: "2026-10-17T13:00:00Z",
      },
    ];

    const ctx = mockCtx();

    vi.spyOn(settingsModule, "getSettings").mockResolvedValue({
      [TASKS_KEY]: JSON.stringify(tasks),
      [MEDIA_DEMANDS_KEY]: "{}",
    } as any);

    const demands = await loadMediaDemandMap(ctx);
    expect(demands["Traumina Cube Silk"]?.count).toBe(1);
    expect(demands["Traumina Cube Silk"]?.requests[0]?.contact).toBe("@client1");
    vi.restoreAllMocks();
  });

  it("openMediaDemandsCount считает только модели без загруженных медиа", async () => {
    const ctx = mockCtx();

    vi.spyOn(settingsModule, "getSettings").mockResolvedValue({
      [MEDIA_DEMANDS_KEY]: JSON.stringify({
        "Model With Media": { model: "Model With Media", count: 2, requests: [] },
        "Model Without Media": { model: "Model Without Media", count: 1, requests: [] },
      }),
      [TASKS_KEY]: "[]",
      [PRODUCT_MEDIA_KEY]: JSON.stringify([
        { id: "1", match: "Model With Media", path: "1.jpg", kind: "image", createdAt: "" },
      ]),
    } as any);

    const count = await openMediaDemandsCount(ctx);
    expect(count).toBe(1); // Только "Model Without Media"
    vi.restoreAllMocks();
  });
});
