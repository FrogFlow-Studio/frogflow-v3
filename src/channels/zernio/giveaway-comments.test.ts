import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { AutomationApi } from "./automations.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));
const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
vi.mock("./api.server", async (orig) => ({
  ...(await orig<typeof import("./api.server")>()),
  zernioRequest: vi.fn(async (path: string, o: { body?: Record<string, unknown> } = {}) => {
    requests.push({ path, body: o.body ?? {} });
    return {};
  }),
}));

const { createGiveaway, closeGiveaway } = await import("@/core/giveaways/giveaway");
const { handleGiveawayComment } = await import("./giveaway-comments.server");
const { dispatchZernioEvent } = await import("./dispatch.server");

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const ACC = "acc-1";
const POST = "17900000000000001";

function setup(opts: { locale?: string; modules?: Record<string, boolean> } = {}) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  const ctx = {
    tenant: {
      id: BOT,
      modules: { giveaways: true, ...opts.modules },
      settings: { default_locale: opts.locale ?? "ru" },
    },
    db,
  } as unknown as TenantContext;
  const replies: Array<{ postId: string; commentId: string; accountId: string; message: string }> =
    [];
  const api = {
    privateReply: vi.fn(
      async (postId: string, commentId: string, accountId: string, message: string) => {
        replies.push({ postId, commentId, accountId, message });
        return { ok: true };
      },
    ),
  } as unknown as AutomationApi;
  return { ctx, db, api, replies };
}

const form = (patch: Record<string, unknown> = {}) => ({
  title: "Осень",
  prize: "Открытки",
  channel: "instagram" as const,
  conditions: "",
  endsAt: "2026-10-11T10:00:00.000Z",
  winners: 1,
  subscribeChannel: "",
  igAccountId: ACC,
  igPostId: POST,
  igPostLabel: "Пост",
  igKeyword: "розыгрыш",
  excludeBlocked: true,
  excludeStaff: true,
  ...patch,
});

const comment = (patch: Record<string, unknown> = {}, text = "Хочу в РОЗЫГРЫШ!") => ({
  account: { accountId: ACC, id: "ig-shop", username: "shop" },
  post: { platformPostId: POST },
  comment: { id: "c1", text, author: { id: "u1", username: "buyer" }, ...patch },
});
const entries = (db: ReturnType<typeof setup>["db"]) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "giveaway.entry");

describe("розыгрыш: участие комментарием в Instagram", () => {
  it("комментарий со словом записывает участника и отвечает в Direct один раз", async () => {
    const { ctx, db, api, replies } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    const r = await handleGiveawayComment(ctx, comment(), api, NOW);
    expect(r.entered).toBe(1);
    expect(entries(db)).toHaveLength(1);
    expect(entries(db)[0]).toMatchObject({
      event_id: `giveaway:${g.id}:entry:ig_u1`,
      payload: { giveaway_id: g.id, channel: "instagram", username: "buyer", dm: "sent" },
    });
    expect(replies).toEqual([
      expect.objectContaining({ postId: POST, commentId: "c1", accountId: ACC }),
    ]);
    expect(replies[0]!.message).toContain("Вы участвуете в розыгрыше «Осень»");
  });

  it("два комментария одного человека — один участник и один ответ", async () => {
    const { ctx, db, api, replies } = setup();
    await createGiveaway(ctx, form(), NOW);
    await handleGiveawayComment(ctx, comment({ id: "c1" }), api, NOW);
    const again = await handleGiveawayComment(ctx, comment({ id: "c2" }), api, NOW);
    expect(again.entered).toBe(0);
    expect(entries(db)).toHaveLength(1);
    expect(replies).toHaveLength(1);
  });

  it("тот же вебхук дважды одновременно — один ответ", async () => {
    const { ctx, db, api, replies } = setup();
    await createGiveaway(ctx, form(), NOW);
    await Promise.all([
      handleGiveawayComment(ctx, comment(), api, NOW),
      handleGiveawayComment(ctx, comment(), api, NOW),
    ]);
    expect(entries(db)).toHaveLength(1);
    expect(replies).toHaveLength(1);
  });

  it("разные люди — разные участники", async () => {
    const { ctx, db, api } = setup();
    await createGiveaway(ctx, form(), NOW);
    await handleGiveawayComment(ctx, comment(), api, NOW);
    await handleGiveawayComment(
      ctx,
      comment({ id: "c9", author: { id: "u2", username: "other" } }),
      api,
      NOW,
    );
    expect(entries(db)).toHaveLength(2);
  });

  it("чужой пост, чужой аккаунт, без слова — не участник и без ответа", async () => {
    const { ctx, db, api, replies } = setup();
    await createGiveaway(ctx, form(), NOW);
    const otherPost = { ...comment(), post: { platformPostId: "999" } };
    expect((await handleGiveawayComment(ctx, otherPost, api, NOW)).entered).toBe(0);
    const otherAcc = { ...comment(), account: { accountId: "acc-2", id: "x", username: "x" } };
    expect((await handleGiveawayComment(ctx, otherAcc, api, NOW)).entered).toBe(0);
    expect((await handleGiveawayComment(ctx, comment({}, "просто привет"), api, NOW)).entered).toBe(
      0,
    );
    expect(entries(db)).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });

  it("без ключевого слова участвует любой комментарий под постом", async () => {
    const { ctx, db, api } = setup();
    await createGiveaway(ctx, form({ igKeyword: "" }), NOW);
    await handleGiveawayComment(ctx, comment({}, "красота"), api, NOW);
    expect(entries(db)).toHaveLength(1);
  });

  it("закрытый и просроченный розыгрыш, розыгрыш только для Telegram, свой комментарий — не принимаются", async () => {
    const { ctx, db, api } = setup();
    const closed = await createGiveaway(ctx, form(), NOW);
    await closeGiveaway(ctx, closed.id, NOW);
    await createGiveaway(ctx, form({ channel: "telegram" }), NOW);
    expect((await handleGiveawayComment(ctx, comment(), api, NOW)).entered).toBe(0);
    const open = await createGiveaway(ctx, form(), NOW);
    const late = new Date("2026-10-12T00:00:00.000Z");
    expect((await handleGiveawayComment(ctx, comment(), api, late)).entered).toBe(0);
    const own = comment({ author: { id: "ig-shop", username: "shop" } });
    expect((await handleGiveawayComment(ctx, own, api, NOW)).entered).toBe(0);
    expect(entries(db)).toHaveLength(0);
    expect(open.status).toBe("open");
  });

  it("свой текст ответа и язык магазина", async () => {
    const own = setup();
    await createGiveaway(own.ctx, form({ igReply: "Вы в игре!" }), NOW);
    await handleGiveawayComment(own.ctx, comment(), own.api, NOW);
    expect(own.replies[0]!.message).toBe("Вы в игре!");
    const en = setup({ locale: "en" });
    await createGiveaway(en.ctx, form(), NOW);
    await handleGiveawayComment(en.ctx, comment(), en.api, NOW);
    expect(en.replies[0]!.message).toContain("You are in the “Осень” giveaway");
  });

  it("отказ Direct: участие остаётся, ответ не повторяется, причина записана", async () => {
    const { ctx, db, api } = setup();
    (api.privateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "окно 7 дней",
    });
    await createGiveaway(ctx, form(), NOW);
    await handleGiveawayComment(ctx, comment({ id: "c1" }), api, NOW);
    await handleGiveawayComment(ctx, comment({ id: "c2" }), api, NOW);
    expect(entries(db)).toHaveLength(1);
    expect(entries(db)[0]!.payload).toMatchObject({ dm: "failed", dm_error: "окно 7 дней" });
    expect(api.privateReply).toHaveBeenCalledTimes(1);
  });
});

describe("розыгрыш: путь через вебхук Zernio", () => {
  it("comment.received с модулем giveaways доходит до участия и личного ответа в Zernio", async () => {
    requests.length = 0;
    const { ctx, db } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    const r = await dispatchZernioEvent(ctx, "evt-1", { event: "comment.received", ...comment() });
    expect(r.status).toBe("processed");
    expect(entries(db)).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toContain(`/inbox/comments/${POST}/c1/private-reply`);
    expect(requests[0]!.body).toMatchObject({ accountId: ACC });
    expect(String(requests[0]!.body.message)).toContain(g.title);
  });

  it("модуль выключен — комментарий не делает участником", async () => {
    requests.length = 0;
    const on = setup();
    await createGiveaway(on.ctx, form(), NOW);
    const off = setup({ modules: { giveaways: false } });
    off.db.tables.app_settings = on.db.tables.app_settings ?? [];
    await dispatchZernioEvent(off.ctx, "evt-2", { event: "comment.received", ...comment() });
    expect(entries(off.db)).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});
