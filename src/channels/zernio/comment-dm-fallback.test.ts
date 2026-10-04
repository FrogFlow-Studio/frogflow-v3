import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  runCommentDmFallback,
  type AutomationApi,
  type AutomationLog,
  type InstagramComment,
} from "./automations.server";
import { ZernioApiError } from "./errors";

// Резервный крон Comment-to-DM (v1 0a8bba4): не слать повторно тем, кому уже писали.
const NOW = new Date("2026-09-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function shop() {
  const db = fakeDb({ unique: { comment_dm_fallback_sends: [["automation_id", "comment_id"]] } });
  db.tables.app_settings = [];
  db.tables.zernio_logs = [];
  db.tables.comment_dm_fallback_sends = [];
  db.tables.bot_users = [
    { bot_id: "b", user_key: "ig_u1", platform: "instagram", zernio_conversation_id: "conv1" },
  ];
  const ctx = {
    tenant: {
      id: "b",
      modules: { instagram: true },
      settings: { zernio: { account_ids: ["acc"] } },
    },
    db,
  } as unknown as TenantContext;
  return { ctx, db };
}

function api(o: {
  comments: InstagramComment[];
  pages: AutomationLog[][];
  reply?: { ok: boolean; error?: string; rateLimitedSec?: number };
}) {
  const privateReply = vi.fn(async () => o.reply ?? { ok: true });
  const inbox = vi.fn(async () => ({ ok: true }));
  const logs = vi.fn(async (_id: string, opts: { skip?: number }) => {
    return o.pages[Math.floor((opts.skip ?? 0) / 200)] ?? [];
  });
  const a = {
    list: async () => [
      {
        id: "auto1",
        name: "r",
        accountId: "acc",
        platformPostId: "post1",
        keywords: ["хочу"],
        dmMessage: "Держите ссылку",
        isActive: true,
      },
    ],
    comments: async () => o.comments,
    logs,
    privateReply,
    publicReply: vi.fn(async () => ({ ok: true })),
    inbox,
    update: vi.fn(),
  } as unknown as AutomationApi;
  return { a, privateReply, inbox, logs };
}

const comment = (id: string, author: string, h: number): InstagramComment => ({
  id,
  message: "хочу",
  createdTime: hoursAgo(h),
  from: { id: author, username: author },
  canReply: true,
});

describe("резервный крон Comment-to-DM", () => {
  it("skipped у Zernio — не догоняем", async () => {
    const { ctx } = shop();
    const t = api({
      comments: [comment("c1", "u1", 1)],
      pages: [[{ status: "skipped", commentId: "c1", createdAt: hoursAgo(1) }]],
    });
    await runCommentDmFallback(ctx, t.a, NOW);
    expect(t.privateReply).not.toHaveBeenCalled();
  });

  it("отказ Meta «уже отвечали» — без эскалации в открытый диалог", async () => {
    const { ctx, db } = shop();
    const t = api({
      comments: [comment("c1", "u1", 1)],
      pages: [[]],
      reply: { ok: false, error: "(#10) error_subcode 2534023" },
    });
    const r = await runCommentDmFallback(ctx, t.a, NOW);
    expect(t.privateReply).toHaveBeenCalledOnce();
    expect(t.inbox).not.toHaveBeenCalled();
    expect(r.failed).toBe(0);
    expect(db.tables.comment_dm_fallback_sends![0]!.status).not.toBe("pending");
  });

  it("логи прочитаны не до конца — старый комментарий не наш, свежий — наш", async () => {
    const { ctx } = shop();
    // Пять полных страниц за последние сутки: про комментарий трёхдневной давности не знаем.
    const page = Array.from({ length: 200 }, (_, i) => ({
      status: "sent",
      commentId: `z${i}`,
      createdAt: hoursAgo(i * 0.02),
    }));
    const t = api({
      comments: [comment("old", "u2", 72), comment("fresh", "u3", 0.5)],
      pages: [page, page, page, page, page],
    });
    await runCommentDmFallback(ctx, t.a, NOW);
    expect(t.logs).toHaveBeenCalledTimes(5);
    const ids = t.privateReply.mock.calls.map((c) => (c as unknown as string[])[1]);
    expect(ids).toEqual(["fresh"]);
  });

  it("второй комментарий того же автора не догоняем", async () => {
    const { ctx } = shop();
    const t = api({
      comments: [comment("c1", "u1", 2), comment("c2", "u1", 1)],
      pages: [[{ status: "sent", commentId: "c1", createdAt: hoursAgo(2) }]],
    });
    await runCommentDmFallback(ctx, t.a, NOW);
    expect(t.privateReply).not.toHaveBeenCalled();
  });

  it("два крона одновременно — одна DM по комментарию и одна строка-резерв", async () => {
    const { ctx, db } = shop();
    const t = api({ comments: [comment("c1", "u1", 1)], pages: [[]] });
    const [a, b] = await Promise.all([
      runCommentDmFallback(ctx, t.a, NOW),
      runCommentDmFallback(ctx, t.a, NOW),
    ]);
    expect(t.privateReply).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
    expect(db.tables.comment_dm_fallback_sends).toHaveLength(1);
  });

  it("429 на отправке: бронь снята, дальше не стучимся, следующий запуск шлёт", async () => {
    const { ctx, db } = shop();
    const t = api({
      comments: [comment("c1", "u1", 1)],
      pages: [[]],
      reply: { ok: false, error: "Zernio API 429", rateLimitedSec: 24 },
    });
    const r = await runCommentDmFallback(ctx, t.a, NOW);
    expect(r.rateLimitedSec).toBe(24);
    expect(r.failed).toBe(0);
    expect(t.inbox).not.toHaveBeenCalled();
    expect(db.tables.comment_dm_fallback_sends).toHaveLength(0);
    // Лимит прошёл — тот же комментарий уходит.
    const ok = api({ comments: [comment("c1", "u1", 1)], pages: [[]] });
    const r2 = await runCommentDmFallback(ctx, ok.a, new Date(NOW.getTime() + 60_000));
    expect(ok.privateReply).toHaveBeenCalledOnce();
    expect(r2.sent).toBe(1);
    expect(r2.rateLimitedSec).toBeUndefined();
  });

  it("429 при чтении правил — не исключение, а отложенный запуск", async () => {
    const { ctx } = shop();
    const t = api({ comments: [], pages: [[]] });
    t.a.list = async () => {
      throw new ZernioApiError("Zernio API 429: Rate limit exceeded", {
        status: 429,
        retryAfterSec: 24,
      });
    };
    const r = await runCommentDmFallback(ctx, t.a, NOW);
    expect(r).toMatchObject({ rateLimitedSec: 24, automationsChecked: 0 });
  });

  it("бюджет времени кончился — правила ждут следующего запуска и идут по кругу", async () => {
    const { ctx } = shop();
    const mk = (id: string, post: string) => ({
      id,
      name: id,
      accountId: "acc",
      platformPostId: post,
      keywords: ["хочу"],
      dmMessage: "Держите",
      isActive: true,
    });
    const t = api({ comments: [comment("c1", "u1", 1)], pages: [[]] });
    t.a.list = async () => [mk("a1", "p1"), mk("a2", "p2")] as never;
    // Бюджет вышел сразу: ничего не сделано, начало очереди запомнено.
    const first = await runCommentDmFallback(ctx, t.a, NOW, () => true);
    expect(first).toMatchObject({ automationsChecked: 0, deferred: 2 });
    expect(t.privateReply).not.toHaveBeenCalled();
    // Бюджет вышел после первого правила: второе — в следующий раз, и оно идёт первым.
    let calls = 0;
    const second = await runCommentDmFallback(ctx, t.a, NOW, () => calls++ >= 1);
    expect(second.automationsChecked).toBe(1);
    expect(second.deferred).toBe(1);
    const third = await runCommentDmFallback(ctx, t.a, NOW);
    expect(third.automationsChecked).toBe(2);
    expect(third.deferred).toBeUndefined();
  });
});
