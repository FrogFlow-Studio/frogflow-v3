import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { syntheticTelegramId, userKey } from "@/core/customers/customers";
import { dispatchZernioEvent } from "./dispatch.server";

const calls: string[] = [];
vi.mock("./automations.server", () => ({
  handleCommentReceived: async () => {
    calls.push("two-step");
    return { note: "второе сообщение" };
  },
}));
vi.mock("./comment-replies.server", () => ({
  replyToCommentByRules: async () => {
    calls.push("public-reply");
    return { status: "sent" };
  },
}));
vi.mock("./comment-consultant.server", () => ({
  replyToCommentByConsultant: async () => {
    calls.push("consultant");
    return { note: "консультант" };
  },
}));
vi.mock("./giveaway-comments.server", () => ({
  handleGiveawayComment: async () => {
    calls.push("giveaway");
    return { note: "розыгрыш", entered: 1 };
  },
}));

const BOT = "00000000-0000-0000-0000-000000000001";
const AUTHOR = "17841400000000001";

function ctxWith(blockedIds: number[], modules: Record<string, boolean>) {
  const db = fakeDb();
  db.tables.blocked_users = blockedIds.map((id) => ({
    bot_id: BOT,
    telegram_id: id,
    username: null,
    first_name: null,
    reason: null,
    blocked_at: "2026-11-23T00:00:00Z",
  }));
  return {
    tenant: { id: BOT, modules, settings: {} },
    db,
  } as unknown as TenantContext;
}

const comment = {
  event: "comment.received",
  account: { accountId: "acc", username: "shop" },
  post: { platformPostId: "p1" },
  comment: { id: "c1", text: "цена?", author: { id: AUTHOR, username: "liliya_albertovna_jld" } },
};

const ALL = { instagram: true, giveaways: true, blocked: true };

describe("dispatch: комментарий заблокированного покупателя", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("заблокирован в «Покупателях» (тот же ключ, что у Direct) — магазин не отвечает ничем", async () => {
    const lilia = syntheticTelegramId(userKey("instagram", AUTHOR));
    const r = await dispatchZernioEvent(ctxWith([lilia], ALL), "evt-1", comment as never);
    expect(r).toEqual({ status: "ignored", note: "покупатель заблокирован" });
    expect(calls).toEqual([]);
  });

  it("не заблокирован — всё работает как раньше", async () => {
    const r = await dispatchZernioEvent(ctxWith([], ALL), "evt-2", comment as never);
    expect(r.status).toBe("processed");
    expect(calls).toEqual(["two-step", "public-reply", "consultant", "giveaway"]);
  });

  it("модуль блокировки выключен — запись в чёрном списке не действует, как и в Direct", async () => {
    const lilia = syntheticTelegramId(userKey("instagram", AUTHOR));
    const r = await dispatchZernioEvent(
      ctxWith([lilia], { instagram: true, giveaways: true, blocked: false }),
      "evt-3",
      comment as never,
    );
    expect(r.status).toBe("processed");
    expect(calls).toContain("two-step");
  });

  it("чёрный список не прочитался — событие падает, а не отвечает заблокированному", async () => {
    const ctx = ctxWith([], ALL);
    const failing = {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }),
      }),
    };
    const broken = { ...ctx, db: { from: () => failing } } as unknown as TenantContext;
    const r = await dispatchZernioEvent(broken, "evt-4", comment as never);
    expect(r.status).toBe("failed");
    expect(calls).toEqual([]);
  });
});
