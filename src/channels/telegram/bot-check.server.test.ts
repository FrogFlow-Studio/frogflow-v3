import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/core/tenant/types";

vi.mock("@/config/env", () => ({
  env: () => ({
    APP_URL: "https://app.test",
    WEBHOOK_SECRET: "s".repeat(40),
    TELEGRAM_API_BASE: "x",
  }),
}));
type Reply = { ok: boolean; result?: unknown; error_code?: number; description?: string };
let replies: Record<string, Reply> = {};
const calls: string[] = [];
vi.mock("./api", () => ({
  telegramApi: () => ({
    call: async (method: string) => {
      calls.push(method);
      return replies[method] ?? { ok: true, result: {} };
    },
  }),
}));
let current: Tenant;
const reinstall = vi.fn();
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: () => ({ secrets: { telegramToken: () => "t" } }),
  requireTenant: async () => current,
}));
vi.mock("@/app/operator/operator.server", () => ({
  reinstallWebhook: (...a: unknown[]) => reinstall(...a),
}));

const { checkBot, repairBot, CHECK_BUDGET_MS } = await import("./bot-check.server");
const { botCommandNames, botCommandsVersion } = await import("./commands");

const WANT = "https://app.test/api/telegram/b1";
const make = (over: Record<string, unknown> = {}): Tenant => {
  const t = {
    id: "b1",
    modules: {},
    telegramTokenEnc: "enc",
    settings: { served_by: "v2", telegram: {} },
    ...over,
  } as unknown as Tenant;
  (t.settings as { telegram: { commands_v?: string } }).telegram.commands_v = botCommandsVersion(t);
  return t;
};
const goodCommands = (t: Tenant): Reply => ({
  ok: true,
  result: botCommandNames(t).map((command) => ({ command })),
});
const good = (t: Tenant) => {
  replies = {
    getMe: { ok: true, result: { username: "shop_bot" } },
    getWebhookInfo: {
      ok: true,
      result: {
        url: WANT,
        pending_update_count: 0,
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
      },
    },
    getMyCommands: goodCommands(t),
  };
};
const codes = (r: { items: Array<{ key: string; code: string }> }) =>
  Object.fromEntries(r.items.map((i) => [i.key, i.code]));

beforeEach(() => {
  calls.length = 0;
  replies = {};
  reinstall.mockReset();
});

describe("Проверить бота", () => {
  it("всё хорошо — четыре зелёных пункта и только чтение", async () => {
    const t = make();
    good(t);
    const r = await checkBot(t);
    expect(r.ok).toBe(true);
    expect(codes(r)).toEqual({ token: "ok", webhook: "ok", updates: "ok", commands: "ok" });
    expect(calls).toEqual(["getMe", "getWebhookInfo", "getMyCommands"]);
  });

  it("чужой вебхук — показываем только хост, не весь адрес", async () => {
    const t = make();
    good(t);
    replies.getWebhookInfo = {
      ok: true,
      result: { url: "https://other.example/hook?secret=zzz", allowed_updates: [] },
    };
    const r = await checkBot(t);
    expect(r.ok).toBe(false);
    const w = r.items.find((i) => i.key === "webhook")!;
    expect(w).toMatchObject({ status: "fail", code: "foreign", params: { host: "other.example" } });
    expect(JSON.stringify(r)).not.toContain("zzz");
    expect(codes(r).updates).toBe("needWebhook");
  });

  it("вебхука нет", async () => {
    const t = make();
    good(t);
    replies.getWebhookInfo = { ok: true, result: { url: "" } };
    expect(codes(await checkBot(t)).webhook).toBe("none");
  });

  it("свежая ошибка доставки — сломано, с очередью; старая — не считается", async () => {
    const t = make();
    good(t);
    const info = (ageS: number) => ({
      ok: true,
      result: {
        url: WANT,
        pending_update_count: 7,
        last_error_message: "Connection timed out",
        last_error_date: Math.floor(Date.now() / 1000) - ageS,
        allowed_updates: ["message", "callback_query", "pre_checkout_query"],
      },
    });
    replies.getWebhookInfo = info(60);
    const fresh = await checkBot(t);
    expect(fresh.items.find((i) => i.key === "webhook")).toMatchObject({
      status: "fail",
      code: "error",
      params: { error: "Connection timed out", pending: 7 },
    });
    replies.getWebhookInfo = info(86_400);
    expect(codes(await checkBot(t)).webhook).toBe("ok");
  });

  it("не хватает типа обновлений (chat_member у школы)", async () => {
    const t = make({ modules: { courses: true } });
    good(t);
    replies.getMyCommands = goodCommands(t);
    const r = await checkBot(t);
    expect(r.items.find((i) => i.key === "updates")).toMatchObject({
      status: "fail",
      code: "missing",
      params: { list: "chat_member" },
    });
  });

  it("мёртвый токен — остальное не проверяем", async () => {
    const t = make();
    replies = { getMe: { ok: false, error_code: 401, description: "Unauthorized" } };
    const r = await checkBot(t);
    expect(codes(r)).toMatchObject({ token: "dead" });
    expect(r.items.find((i) => i.key === "token")!.status).toBe("fail");
    expect(calls).toEqual(["getMe"]);
    expect(r.items.filter((i) => i.status === "unknown")).toHaveLength(3);
  });

  it("Telegram не ответил (обрыв) — «неизвестно», а не «токен мёртв»", async () => {
    const t = make();
    replies = { getMe: { ok: false, description: "timeout" } };
    const r = await checkBot(t);
    expect(r.items[0]).toMatchObject({ status: "unknown", code: "noReply" });
    expect(r.ok).toBe(false);
  });

  it("меню команд: нет, устарело, нет ответа", async () => {
    const t = make();
    good(t);
    replies.getMyCommands = { ok: true, result: [] };
    expect(codes(await checkBot(t)).commands).toBe("none");
    replies.getMyCommands = { ok: true, result: [{ command: "catalog" }] };
    expect(codes(await checkBot(t)).commands).toBe("stale");
    replies.getMyCommands = { ok: false, description: "network error" };
    expect(codes(await checkBot(t)).commands).toBe("noReply");
  });

  it("бюджет времени вышел — оставшиеся пункты «не успели», Telegram больше не зовём", async () => {
    const t = make();
    good(t);
    let clock = 0;
    const r = await checkBot(t, { now: () => (clock += CHECK_BUDGET_MS + 1) });
    expect(calls).toEqual(["getMe"]);
    expect(r.items.filter((i) => i.code === "late")).toHaveLength(3);
    expect(r.ok).toBe(false);
  });

  it("клиент v1 или без токена — Telegram не трогаем", async () => {
    const v1 = make({ settings: { telegram: {} } });
    expect(await checkBot(v1)).toMatchObject({ skipped: "not_v2" });
    expect(await checkBot(make({ telegramTokenEnc: null }))).toMatchObject({ skipped: "no_token" });
    expect(calls).toEqual([]);
  });
});

describe("Починить", () => {
  it("зовёт установку вебхука один раз и проверяет заново по свежим настройкам", async () => {
    const broken = make();
    current = broken;
    good(broken);
    replies.getWebhookInfo = { ok: true, result: { url: "" } };
    reinstall.mockImplementation(async () => {
      // После установки вебхук стоит на нашем адресе.
      replies.getWebhookInfo = {
        ok: true,
        result: { url: WANT, allowed_updates: ["message", "callback_query", "pre_checkout_query"] },
      };
      return { ok: true, url: WANT, pending: 0 };
    });
    const r = await repairBot("b1", "admin");
    expect(reinstall).toHaveBeenCalledTimes(1);
    expect(reinstall).toHaveBeenCalledWith("b1", "admin");
    expect(r.check.ok).toBe(true);
    expect(r.installError).toBeUndefined();
  });

  it("Telegram отказал в установке — ошибка и проверка показывают, что осталось сломано", async () => {
    current = make();
    good(current);
    replies.getWebhookInfo = { ok: true, result: { url: "" } };
    reinstall.mockResolvedValue({ ok: false, url: null, pending: 0, error: "bad webhook" });
    const r = await repairBot("b1");
    expect(r.installError).toEqual({ code: "telegram", reason: "bad webhook" });
    expect(codes(r.check).webhook).toBe("none");
  });

  it("исключение при установке не уходит продавцу текстом", async () => {
    current = make();
    good(current);
    reinstall.mockRejectedValue(new Error("секрет внутренней ошибки"));
    const r = await repairBot("b1");
    expect(r.installError).toEqual({ code: "unknown" });
  });

  it("клиент не на v2 — установку не зовём", async () => {
    current = make({ settings: { telegram: {} } });
    const r = await repairBot("b1");
    expect(reinstall).not.toHaveBeenCalled();
    expect(r.check.skipped).toBe("not_v2");
  });
});
