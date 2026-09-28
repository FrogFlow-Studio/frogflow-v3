import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ANSWERED_KEY, RULES_KEY, replyToCommentByRules } from "./comment-replies.server";

// Автоответы на комментарии без Direct (v1 4cfbae3): исполнение правил продавца.
function shop() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    {
      bot_id: "b",
      key: RULES_KEY,
      value: JSON.stringify([
        {
          id: "r1",
          name: "Цена",
          keywords: ["цена"],
          matchMode: "contains",
          platformPostId: null,
          replies: ["Написали вам", "Ответили в личку"],
          isActive: true,
          createdAt: "2026-09-01T00:00:00Z",
        },
      ]),
    },
  ];
  const ctx = {
    tenant: { id: "b", modules: { instagram: true }, settings: {} },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

const input = (over: Record<string, string> = {}) => ({
  accountId: "acc",
  commentId: "c1",
  commentText: "какая цена?",
  platformPostId: "post1",
  authorUsername: "buyer",
  accountUsername: "shop",
  ...over,
});

describe("автоответы на комментарии без Direct", () => {
  it("отвечает публично один раз, варианты по кругу, отметка — после отправки", async () => {
    const { ctx, db } = shop();
    const publicReply = vi.fn(async () => ({ ok: true }));
    expect((await replyToCommentByRules(ctx, input(), { publicReply })).status).toBe("sent");
    expect((await replyToCommentByRules(ctx, input(), { publicReply })).status).toBe("already");
    await replyToCommentByRules(ctx, input({ commentId: "c2" }), { publicReply });
    expect(publicReply.mock.calls.map((c) => (c as unknown as string[])[3])).toEqual([
      "Написали вам",
      "Ответили в личку",
    ]);
    const answered = JSON.parse(
      String(db.tables.app_settings!.find((r) => r.key === ANSWERED_KEY)!.value),
    );
    expect(answered).toHaveLength(2);
  });

  it("сбой отправки не съедает попытку; свой комментарий и без совпадения — не отвечаем", async () => {
    const { ctx, db } = shop();
    const fail = vi.fn(async () => ({ ok: false, error: "boom" }));
    expect((await replyToCommentByRules(ctx, input(), { publicReply: fail })).status).toBe(
      "failed",
    );
    expect(db.tables.app_settings!.some((r) => r.key === ANSWERED_KEY)).toBe(false);
    const ok = vi.fn(async () => ({ ok: true }));
    expect(
      (await replyToCommentByRules(ctx, input({ authorUsername: "SHOP" }), { publicReply: ok }))
        .status,
    ).toBe("skipped");
    expect(
      (await replyToCommentByRules(ctx, input({ commentText: "красиво" }), { publicReply: ok }))
        .status,
    ).toBe("no_rule");
    expect(ok).not.toHaveBeenCalled();
  });
});
