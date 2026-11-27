import { describe, expect, it } from "vitest";
import type { TelegramApi } from "@/channels/telegram/api";
import { refreshVipCount } from "./vip";
import type { V4Db } from "../core/db";

function api(result: { ok: boolean; result?: number }): TelegramApi {
  return { call: async () => result } as unknown as TelegramApi;
}

describe("счётчик VIP-группы", () => {
  it("пишет число из Telegram и не затирает его нулём при сбое", async () => {
    const calls: unknown[] = [];
    const db: V4Db = {
      async call(fn, args) {
        calls.push({ fn, args });
        return [{ note_vip_count: 12 }];
      },
    };
    expect(
      await refreshVipCount(db, api({ ok: true, result: 12 }), { botId: "b", chatId: "-100" }),
    ).toBe(12);
    expect(calls).toHaveLength(1);
    expect(
      await refreshVipCount(db, api({ ok: false }), { botId: "b", chatId: "-100" }),
    ).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
