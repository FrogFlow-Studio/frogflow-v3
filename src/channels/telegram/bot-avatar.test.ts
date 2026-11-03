import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { BOT_AVATAR_KEY, parseBotAvatar } from "@/core/storefront/bot-avatar";
import type { TelegramApi } from "./api";

/**
 * Аватар бота в шапке витрины (03.11.2026, Яков: «вместо зелёного кружка —
 * аватар бота, и у других клиентов»): крон забирает фото раз в сутки.
 */
const uploads: string[] = [];
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async (key: string) => {
          uploads.push(key);
          return { error: null };
        },
      }),
    },
  }),
}));
const { syncBotAvatar, pickSize } = await import("./bot-avatar.server");

const T = "11111111-2222-3333-4444-555555555555";
const NOW = Date.parse("2026-11-03T12:00:00Z");

beforeAll(() => setEnvForTests({}));
afterAll(() => setEnvForTests(undefined));

function shop(photos: Array<{ file_unique_id: string; width: number }>) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const tenant = {
    id: T,
    telegramTokenEnc: "enc",
    modules: {},
    settings: { served_by: "v2" },
  } as unknown as Tenant;
  const ctx = { tenant, db } as unknown as TenantContext;
  const calls: string[] = [];
  const api: TelegramApi = {
    call: async <R>(m: string) => {
      calls.push(m);
      const result =
        m === "getMe"
          ? { id: 42 }
          : m === "getUserProfilePhotos"
            ? {
                photos: photos.length
                  ? [photos.map((p) => ({ ...p, file_id: `F-${p.file_unique_id}` }))]
                  : [],
              }
            : { file_path: "photos/x.jpg" };
      return { ok: true, result: result as R };
    },
    fileUrl: (p) => `https://tg.test/file/${p}`,
  };
  const row = () =>
    parseBotAvatar(
      ((db.tables.app_settings as Array<{ key: string; value: string }>).find(
        (r) => r.key === BOT_AVATAR_KEY,
      )?.value ?? null) as string | null,
      T,
    );
  return { tenant, ctx, api, calls, row, photos };
}

describe("аватар бота для витрины", () => {
  it("берёт размер не меньше 320 px, иначе самый крупный", () => {
    const s = (w: number) => ({ file_id: `${w}`, file_unique_id: `${w}`, width: w });
    expect(pickSize([s(640), s(160), s(320)])?.width).toBe(320);
    expect(pickSize([s(160), s(90)])?.width).toBe(160);
    expect(pickSize([])).toBeNull();
  });

  it("фото есть — кладёт в Storage и пишет путь; сутки не ходит в Telegram повторно", async () => {
    const x = shop([
      { file_unique_id: "AQADsmall", width: 160 },
      { file_unique_id: "AQADmid", width: 640 },
    ]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    uploads.length = 0;
    const r = await syncBotAvatar(x.tenant, NOW, { api: x.api, ctx: x.ctx });
    expect(r).toEqual({ action: "updated", path: `${T}/brand/bot-avatar-AQADmid.jpg` });
    expect(uploads).toEqual([`${T}/brand/bot-avatar-AQADmid.jpg`]);
    expect(x.row()).toMatchObject({ path: `${T}/brand/bot-avatar-AQADmid.jpg`, uid: "AQADmid" });
    expect(fetchMock).toHaveBeenCalledWith("https://tg.test/file/photos/x.jpg", expect.anything());

    // Через час (следующий запуск крона) — без вызовов Telegram.
    x.calls.length = 0;
    expect(await syncBotAvatar(x.tenant, NOW + 3600_000, { api: x.api, ctx: x.ctx })).toEqual({
      action: "fresh",
    });
    expect(x.calls).toEqual([]);

    // Через сутки фото то же — не перекачиваем.
    uploads.length = 0;
    expect(await syncBotAvatar(x.tenant, NOW + 25 * 3600_000, { api: x.api, ctx: x.ctx })).toEqual({
      action: "unchanged",
    });
    expect(uploads).toEqual([]);
    fetchMock.mockRestore();
  });

  it("два крона одновременно — фото качает только один", async () => {
    const x = shop([{ file_unique_id: "AQADone", width: 320 }]);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(new Uint8Array([1])));
    uploads.length = 0;
    const rs = await Promise.all([
      syncBotAvatar(x.tenant, NOW, { api: x.api, ctx: x.ctx }),
      syncBotAvatar(x.tenant, NOW, { api: x.api, ctx: x.ctx }),
    ]);
    expect(rs.map((r) => r.action).sort()).toEqual(["fresh", "updated"]);
    expect(uploads).toHaveLength(1);
    fetchMock.mockRestore();
  });

  it("у бота нет фото — пути нет, витрина рисует буквы", async () => {
    const x = shop([]);
    expect(await syncBotAvatar(x.tenant, NOW, { api: x.api, ctx: x.ctx })).toEqual({
      action: "none",
    });
    expect(x.row()).toMatchObject({ path: null });
  });

  it("клиент v1 и бот без токена не трогаются", async () => {
    const x = shop([{ file_unique_id: "AQADone", width: 320 }]);
    const v1 = { ...x.tenant, settings: { served_by: "v1" } } as unknown as Tenant;
    expect(await syncBotAvatar(v1, NOW, { api: x.api, ctx: x.ctx })).toEqual({
      action: "skipped",
    });
    const noToken = { ...x.tenant, telegramTokenEnc: null } as unknown as Tenant;
    expect(await syncBotAvatar(noToken, NOW, { api: x.api, ctx: x.ctx })).toEqual({
      action: "skipped",
    });
    expect(x.calls).toEqual([]);
  });

  it("запись с чужим путём не даёт картинку чужого магазина", () => {
    const raw = JSON.stringify({
      path: "other-bot/brand/bot-avatar-X.jpg",
      uid: "X",
      checkedAt: new Date(NOW).toISOString(),
    });
    expect(parseBotAvatar(raw, T)).toMatchObject({ path: null, uid: null });
    expect(parseBotAvatar("{oops", T)).toBeNull();
  });
});
