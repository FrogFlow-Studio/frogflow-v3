import { describe, expect, it } from "vitest";
import type { TelegramApi, TgResult } from "../api";
import { vipGroupMemberCount } from "./group";

function api(answer: () => Promise<TgResult>): TelegramApi & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    call: async <T>(method: string, payload?: unknown) => {
      calls.push([method, payload]);
      return (await answer()) as TgResult<T>;
    },
    fileUrl: (p) => p,
  };
}

describe("vipGroupMemberCount — люди в группе по Telegram", () => {
  it("возвращает число из getChatMemberCount для группы продавца", async () => {
    const a = api(async () => ({ ok: true, result: 37 }));
    expect(await vipGroupMemberCount(a, "-1001234")).toBe(37);
    expect(a.calls).toEqual([["getChatMemberCount", { chat_id: "-1001234" }]]);
  });

  it("бот не в группе — «не удалось узнать», а не ноль", async () => {
    const a = api(async () => ({ ok: false, error_code: 400, description: "chat not found" }));
    expect(await vipGroupMemberCount(a, "-1001234")).toBeNull();
  });

  it("сеть упала — null, страница не падает", async () => {
    const a = api(async () => {
      throw new Error("network");
    });
    expect(await vipGroupMemberCount(a, "-1001234")).toBeNull();
  });

  it("Telegram молчит дольше предела — null, страница не ждёт", async () => {
    const a = api(() => new Promise<TgResult>(() => {}));
    expect(await vipGroupMemberCount(a, "-1001234", 20)).toBeNull();
  });

  it("группа не указана — Telegram не спрашиваем", async () => {
    const a = api(async () => ({ ok: true, result: 5 }));
    expect(await vipGroupMemberCount(a, "")).toBeNull();
    expect(a.calls).toEqual([]);
  });
});
