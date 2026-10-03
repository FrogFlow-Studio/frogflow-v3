import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

const requests: Array<[string, { method?: string; body?: unknown }]> = [];
let reply: unknown = { post: { _id: "p-1", status: "published" } };
vi.mock(import("./api.server"), async (importOriginal) => ({
  ...(await importOriginal()),
  zernioRequest: vi.fn(async (endpoint: string, o: { method?: string; body?: unknown } = {}) => {
    requests.push([endpoint, o]);
    if (reply instanceof Error) throw reply;
    return reply as never;
  }) as never,
}));
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (key: string) => ({
          data: key.includes("missing") ? null : { signedUrl: `https://s.test/${bucket}/${key}` },
        }),
      }),
    },
  }),
}));

const { publishPost, cancelScheduledPost, listOwnPosts } = await import("./posts.server");

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-09-26T12:00:00Z");
function ctxFor(db = fakeDb({ unique: { zernio_logs: [["event_id"]] } })) {
  const ctx = {
    tenant: {
      id: BOT,
      settings: {
        zernio: {
          accounts: [
            { id: "ig-1", platform: "instagram", username: "shop" },
            { id: "ig-old", platform: "instagram", expired: true },
            { id: "wa-1", platform: "whatsapp" },
          ],
        },
      },
    },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}
const input = (o: Record<string, unknown> = {}) => ({
  kind: "feed" as const,
  accountIds: ["ig-1"],
  text: "Новинка",
  media: [`${BOT}/a.jpg`],
  ...o,
});

beforeEach(() => {
  requests.length = 0;
  reply = { post: { _id: "p-1", status: "published" } };
});

describe("publishPost", () => {
  it("публикует по подписанной ссылке и пишет строку в журнал", async () => {
    const { ctx, db } = ctxFor();
    const r = await publishPost(ctx, input(), NOW);
    expect(r).toEqual({ ok: true, postId: "p-1", state: "published" });
    expect(requests[0]![0]).toBe("/posts");
    expect(requests[0]![1].body).toMatchObject({
      content: "Новинка",
      mediaItems: [{ type: "image", url: `https://s.test/product-images/${BOT}/a.jpg` }],
      platforms: [{ platform: "instagram", accountId: "ig-1" }],
      publishNow: true,
    });
    expect(db.tables.zernio_logs).toHaveLength(1);
    expect(db.tables.zernio_logs![0]).toMatchObject({
      event_id: "post:p-1",
      event_type: "post.created",
      status: "processed",
    });
  });

  it("видео берётся из бакета файлов", async () => {
    const { ctx } = ctxFor();
    await publishPost(ctx, input({ kind: "reel", media: [`${BOT}/clip.mp4`] }), NOW);
    expect(requests[0]![1].body).toMatchObject({
      mediaItems: [{ type: "video", url: `https://s.test/product-files/${BOT}/clip.mp4` }],
    });
  });

  it("чужой файл, неподходящий формат, отключённый и чужой аккаунт — до Zernio не доходит", async () => {
    const { ctx } = ctxFor();
    expect(await publishPost(ctx, input({ media: ["other-bot/a.jpg"] }), NOW)).toEqual({
      ok: false,
      errors: ["bad_media_url"],
    });
    expect(await publishPost(ctx, input({ media: [`${BOT}/a.webp`] }), NOW)).toEqual({
      ok: false,
      errors: ["bad_media_type"],
    });
    expect(await publishPost(ctx, input({ accountIds: ["ig-old"] }), NOW)).toEqual({
      ok: false,
      errors: ["foreign_account"],
    });
    expect(await publishPost(ctx, input({ accountIds: ["wa-1"] }), NOW)).toEqual({
      ok: false,
      errors: ["foreign_account"],
    });
    expect(requests).toHaveLength(0);
  });

  it("повтор той же публикации отдаёт первую, второй пост не создаётся", async () => {
    const { ctx } = ctxFor();
    await publishPost(ctx, input(), NOW);
    const again = await publishPost(ctx, input(), new Date(NOW.getTime() + 60_000));
    expect(again).toMatchObject({ ok: true, postId: "p-1" });
    expect(requests).toHaveLength(1);
    // Другой текст — уже другая публикация.
    reply = { post: { _id: "p-2", status: "published" } };
    expect(await publishPost(ctx, input({ text: "Другое" }), NOW)).toMatchObject({ postId: "p-2" });
  });

  it("отказ Instagram и сбой Zernio — ошибка продавцу и строка failed", async () => {
    const { ctx, db } = ctxFor();
    reply = {
      post: { _id: "p-3", status: "failed", platforms: [{ errorMessage: "Aspect ratio" }] },
    };
    expect(await publishPost(ctx, input(), NOW)).toEqual({ ok: false, error: "Aspect ratio" });
    reply = new Error("Zernio API 500: boom");
    expect(await publishPost(ctx, input({ text: "x" }), NOW)).toEqual({
      ok: false,
      error: "Zernio API 500: boom",
    });
    expect(db.tables.zernio_logs!.map((r) => r.status)).toEqual(["failed", "failed"]);
    // Сбой не считается «уже опубликовано»: повтор идёт в Zernio.
    reply = { post: { _id: "p-4", status: "published" } };
    expect(await publishPost(ctx, input({ text: "x" }), NOW)).toMatchObject({ postId: "p-4" });
  });
});

describe("cancelScheduledPost и listOwnPosts", () => {
  it("снять можно только свой пост; снятый виден в списке", async () => {
    const { ctx } = ctxFor();
    reply = { post: { _id: "p-9", status: "scheduled" } };
    await publishPost(ctx, input({ scheduledFor: "2026-09-27T09:00:00.000Z" }), NOW);
    expect(await cancelScheduledPost(ctx, "someone-else")).toBe(false);
    expect(await cancelScheduledPost(ctx, "p-9")).toBe(true);
    expect(requests.at(-1)).toEqual(["/posts/p-9", { method: "DELETE" }]);
    const rows = await listOwnPosts(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ postId: "p-9", state: "cancelled" });
  });
});

describe("сбой чтения журнала не создаёт пост", () => {
  it("не прочиталась проверка повтора — ошибка, в Zernio ничего не ушло", async () => {
    const { withBrokenReads } = await import("../../../tests/broken-db");
    const { ctx } = ctxFor(withBrokenReads(fakeDb(), ["zernio_logs"]));
    await expect(publishPost(ctx, input(), NOW)).rejects.toThrow(/журнал постов не прочитан/);
    expect(requests).toHaveLength(0);
  });
});
