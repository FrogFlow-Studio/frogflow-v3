import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

/** Меню команд ставится только боту v2 и только когда набор сменился. */
vi.mock("@/config/env", () => ({
  env: () => ({ APP_URL: "https://app.test", WEBHOOK_SECRET: "s", TELEGRAM_API_BASE: undefined }),
}));

const calls: Array<[string, Record<string, unknown>]> = [];
let webhookUrl: string | null = null;
vi.mock("./api", () => ({
  telegramApi: () => ({
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      if (method === "getWebhookInfo")
        return {
          ok: true,
          result: {
            url: webhookUrl,
            pending_update_count: 0,
            allowed_updates: ["message", "callback_query", "pre_checkout_query"],
          },
        };
      return { ok: true, result: true };
    }),
  }),
}));

const patches: Array<Record<string, unknown>> = [];
/** Сколько включённых товаров у клиента (sellsNow считает их запросом). */
let activeProducts = 0;
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (tenant: Tenant) => ({
    tenant,
    secrets: { telegramToken: () => "t" },
    db: {
      from: () => ({
        select: () => ({ eq: async () => ({ count: activeProducts, error: null }) }),
      }),
    },
  }),
  patchTenantSettings: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    patches.push(patch);
  }),
}));

const { ensureTelegramWebhook, releaseTelegramToV1 } = await import("./webhook-setup.server");
const { botCommandsVersion } = await import("./commands");
const { telegramWebhookUrl } = await import("./secret");

function tenant(settings: Record<string, unknown>, over: Record<string, unknown> = {}): Tenant {
  return {
    id: "bot-1",
    vertical: "digital",
    telegramTokenEnc: "enc",
    modules: {},
    settings: { default_locale: "ru", ...settings },
    ...over,
  } as unknown as Tenant;
}

const commandsOf = (lang?: string) =>
  (
    calls.find(([m, p]) => m === "setMyCommands" && p.language_code === lang)?.[1].commands as
      Array<{ command: string }> | undefined
  )?.map((c) => c.command);
const buttonOf = () => calls.find(([m]) => m === "setChatMenuButton")?.[1].menu_button;

const methods = () => calls.map(([m]) => m);

beforeEach(() => {
  calls.length = 0;
  patches.length = 0;
  webhookUrl = null;
  activeProducts = 0;
});

describe("меню команд при включении v2", () => {
  it("клиент v1 — боту ничего не ставим", async () => {
    await ensureTelegramWebhook(tenant({ served_by: "v1" }), true);
    expect(calls).toEqual([]);
  });

  it("включили v2 — вебхук и меню на всех языках, отпечаток записан", async () => {
    const t = tenant({ served_by: "v2" });
    await ensureTelegramWebhook(t, true);
    expect(methods()).toContain("setWebhook");
    expect(methods().filter((m) => m === "setMyCommands")).toHaveLength(5);
    expect(patches).toContainEqual({ telegram: { commands_v: botCommandsVersion(t) } });
  });

  it("вебхук на месте, меню ещё не ставили — крон ставит только меню", async () => {
    webhookUrl = telegramWebhookUrl("https://app.test", "bot-1");
    await ensureTelegramWebhook(tenant({ served_by: "v2" }));
    expect(methods()).not.toContain("setWebhook");
    expect(methods().filter((m) => m === "setMyCommands")).toHaveLength(5);
  });

  it("меню того же набора уже стоит — Telegram не зовём", async () => {
    webhookUrl = telegramWebhookUrl("https://app.test", "bot-1");
    const base = tenant({ served_by: "v2" });
    const t = tenant({ served_by: "v2", telegram: { commands_v: botCommandsVersion(base) } });
    await ensureTelegramWebhook(t);
    expect(methods()).toEqual(["getWebhookInfo"]);
  });

  it("откат на v1 убирает меню и сбрасывает отпечаток", async () => {
    await releaseTelegramToV1(tenant({ served_by: "v1" }));
    expect(methods().filter((m) => m === "deleteMyCommands")).toHaveLength(5);
    expect(patches).toContainEqual({ telegram: { commands_v: "" } });
  });

  it("консультант без товаров (BOVI) — без /catalog, /cart, /orders и без кнопки витрины", async () => {
    const consultant = { vertical: "consultant", modules: { shop: true, telegram_mini_app: true } };
    const t = tenant({ served_by: "v2" }, consultant);
    await ensureTelegramWebhook(t, true);
    expect(commandsOf()).toEqual(["stop"]);
    expect(commandsOf("kk")).toEqual(["stop"]);
    expect(buttonOf()).toEqual({ type: "default" });
    expect(patches).toContainEqual({ telegram: { commands_v: botCommandsVersion(t, false) } });
    expect(botCommandsVersion(t, false)).not.toBe(botCommandsVersion(t, true));
  });

  it("у консультанта появились товары — крон переставляет меню с каталогом и витриной", async () => {
    webhookUrl = telegramWebhookUrl("https://app.test", "bot-1");
    const consultant = { vertical: "consultant", modules: { shop: true, telegram_mini_app: true } };
    const before = tenant({ served_by: "v2" }, consultant);
    const t = tenant(
      { served_by: "v2", telegram: { commands_v: botCommandsVersion(before, false) } },
      consultant,
    );
    activeProducts = 3;
    await ensureTelegramWebhook(t);
    expect(commandsOf()).toEqual(["catalog", "cart", "orders", "stop"]);
    await ensureTelegramWebhook(t, true);
    expect(buttonOf()).toMatchObject({ type: "web_app", text: "🛍 Магазин" });
  });
});
