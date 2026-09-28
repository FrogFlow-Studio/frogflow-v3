import { describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

vi.mock("@/config/env", () => ({ env: () => ({ APP_URL: "https://app.test" }) }));

const { syncMenuButton } = await import("./webhook-setup.server");

function apiSpy() {
  const calls: Array<[string, unknown]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: unknown) => {
      calls.push([method, payload]);
      return { ok: true };
    }),
  };
  return { api: api as never, calls };
}

const tenant = (modules: Record<string, boolean>) =>
  ({ id: "bot-1", modules, settings: { slug: "shop" } }) as unknown as Tenant;

describe("syncMenuButton: кнопка меню бота", () => {
  it("модуль Mini App выключен — кнопка меню сбрасывается на стандартную", async () => {
    const off: Array<Record<string, boolean>> = [
      { shop: true },
      { telegram_mini_app: true },
      { shop: true, telegram_mini_app: false },
    ];
    for (const modules of off) {
      const { api, calls } = apiSpy();
      await syncMenuButton(tenant(modules), api);
      expect(calls).toEqual([["setChatMenuButton", { menu_button: { type: "default" } }]]);
    }
  });

  it("модуль включён — «Магазин» открывает витрину клиента", async () => {
    const { api, calls } = apiSpy();
    await syncMenuButton(tenant({ shop: true, telegram_mini_app: true }), api);
    expect(calls).toEqual([
      [
        "setChatMenuButton",
        {
          menu_button: {
            type: "web_app",
            text: "🛍 Магазин",
            web_app: { url: "https://app.test/s/shop" },
          },
        },
      ],
    ]);
  });
});
