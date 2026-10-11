import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvForTests } from "@/config/env";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { AutomationApi } from "./automations.server";
import type { ConsultantResult } from "@/core/consultant/engine.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { replyToCommentByConsultant, COMMENT_CONSULTANT_EVENT } =
  await import("./comment-consultant.server");
const { consultantCommentAnswer } = await import("@/core/consultant/comment-reply.server");
const { COMMENT_NEUTRAL } = await import("@/core/consultant/comment-reply");

const BOVI = "bb3ffba7-edf0-4cce-8742-ff10c9495c44";
const OTHER = "22222222-2222-2222-2222-222222222222";
const ACC = "acc-bovi";
const POST = "17895039849393937";
const CAPTION =
  "Немецкая мануфактура Traumina взяла технологию,как у NASA и воплотила её в одеяле Cube Fazer — нашем бестселлере в Bovi еще с 2013 года!";
const PRICE_REPLY =
  "Здравствуйте! Одеяло Traumina Cube Fazer: 155×200 — 98 000 ₸, 200×220 — 128 000 ₸. Напишите, какой размер нужен, подскажу.";

beforeEach(() => setEnvForTests({ ANTHROPIC_API_KEY: "test-key" }));
afterEach(() => setEnvForTests(undefined));

function setup(opts: { bot?: string; settings?: Record<string, string>; servedBy?: string } = {}) {
  const bot = opts.bot ?? BOVI;
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.app_settings = Object.entries(opts.settings ?? {}).map(([key, value]) => ({
    bot_id: bot,
    key,
    value,
  }));
  const ctx = {
    tenant: {
      id: bot,
      vertical: "consultant",
      modules: { instagram: true },
      settings: { served_by: opts.servedBy ?? "v2", default_locale: "ru" },
    },
    db,
  } as unknown as TenantContext;
  const replies: Array<{ postId: string; commentId: string; message: string }> = [];
  const api = {
    privateReply: vi.fn(
      async (postId: string, commentId: string, _acc: string, message: string) => {
        replies.push({ postId, commentId, message });
        return { ok: true };
      },
    ),
    list: vi.fn(async () => []),
  } as unknown as AutomationApi;
  return { ctx, db, api, replies };
}

const payload = (text = "Куб", patch: Record<string, unknown> = {}) => ({
  account: { accountId: ACC, id: "ig-bovi", username: "bovi_kz" },
  post: { platformPostId: POST, content: CAPTION },
  comment: { id: "c1", text, author: { id: "1068895099485523", username: "dina_k777" }, ...patch },
});

/** Настоящий отбор ответа (core) поверх подменённого консультанта: модель не зовём. */
const answerWith =
  (r: Partial<ConsultantResult> | null, calls: string[] = []) =>
  (ctx: TenantContext, p: Parameters<typeof consultantCommentAnswer>[1]) =>
    consultantCommentAnswer(ctx, p, async (text, story) => {
      calls.push(`${story.storyId}|${story.caption ?? ""}|${text}`);
      return r
        ? { reply: "", handoff: null, usage: { inputTokens: 1, outputTokens: 1, usd: 0.004 }, ...r }
        : null;
    });

const logs = (db: ReturnType<typeof setup>["db"]) =>
  (db.tables.zernio_logs ?? []).filter((r) => r.event_type === COMMENT_CONSULTANT_EVENT);

describe("консультант отвечает на комментарий одним сообщением в Direct", () => {
  it("BOVI: «Куб» под постом про Cube Fazer — цена из ответа консультанта уходит private reply", async () => {
    const { ctx, db, api, replies } = setup();
    const calls: string[] = [];
    const r = await replyToCommentByConsultant(ctx, payload(), {
      api,
      answer: answerWith({ reply: PRICE_REPLY, model: "claude-sonnet-5" }, calls),
    });
    expect(r.note).toContain("цена");
    expect(replies).toEqual([{ postId: POST, commentId: "c1", message: PRICE_REPLY }]);
    // Консультант видит публикацию (id и подпись) и пометку, что это комментарий.
    expect(calls[0]).toContain(POST);
    expect(calls[0]).toContain("Cube Fazer");
    expect(calls[0]).toContain("комментарий под публикацией");
    expect(calls[0]).toMatch(/Куб$/);
    expect(logs(db)).toHaveLength(1);
    expect(logs(db)[0]).toMatchObject({ status: "processed" });
    expect(logs(db)[0]!.payload).toMatchObject({
      kind: "price",
      reply: PRICE_REPLY,
      comment: "Куб",
      usd: 0.004,
    });
    // Комментарий и ответ — в историю диалога: в Direct бот не начнёт заново.
    const user = (db.tables.bot_users ?? [])[0] as { state: { consultant: { recent: unknown[] } } };
    expect(user.state.consultant.recent).toEqual([
      { role: "customer", text: "[комментарий под публикацией] Куб" },
      { role: "assistant", text: PRICE_REPLY },
    ]);
  });

  it("цены в ответе нет — дежурное приглашение, а не догадка", async () => {
    const { ctx, db, api, replies } = setup();
    await replyToCommentByConsultant(ctx, payload("Можно инфо"), {
      api,
      answer: answerWith({ reply: "Здравствуйте! Какое полотенце вас интересует?" }),
    });
    expect(replies.map((x) => x.message)).toEqual([COMMENT_NEUTRAL.ru]);
    expect(logs(db)[0]!.payload).toMatchObject({ kind: "neutral", why: "в ответе нет цены" });
  });

  it("консультант передал бы менеджеру или не ответил — дежурное приглашение", async () => {
    for (const r of [
      {
        reply: "Передам менеджеру, 98 000 ₸",
        handoff: { kind: "handoff" as const, reason: "wholesale", summary: "" },
      },
      null,
    ]) {
      const { ctx, api, replies } = setup();
      await replyToCommentByConsultant(ctx, payload("Опт?"), {
        api,
        answer: answerWith(r as Partial<ConsultantResult> | null),
      });
      expect(replies.map((x) => x.message)).toEqual([COMMENT_NEUTRAL.ru]);
    }
  });

  it("сбой консультанта (исключение) — всё равно приглашение, комментарий не остаётся без ответа", async () => {
    const { ctx, api, replies } = setup();
    await replyToCommentByConsultant(ctx, payload(), {
      api,
      answer: (c, p) =>
        consultantCommentAnswer(c, p, async () => {
          throw new Error("credit balance is too low");
        }),
    });
    expect(replies.map((x) => x.message)).toEqual([COMMENT_NEUTRAL.ru]);
  });

  it("повтор события и второй комментарий того же человека под тем же постом — одно сообщение", async () => {
    const { ctx, api, replies } = setup();
    const answer = answerWith({ reply: PRICE_REPLY });
    await replyToCommentByConsultant(ctx, payload(), { api, answer });
    await replyToCommentByConsultant(ctx, payload(), { api, answer });
    const r = await replyToCommentByConsultant(ctx, payload("А семейное?", { id: "c2" }), {
      api,
      answer,
    });
    expect(r.note).toContain("уже ответили");
    expect(replies).toHaveLength(1);
  });

  it("гонка: два одновременных события — шлёт только выигравший отметку", async () => {
    const { ctx, api, replies } = setup();
    const answer = answerWith({ reply: PRICE_REPLY });
    await Promise.all([
      replyToCommentByConsultant(ctx, payload(), { api, answer }),
      replyToCommentByConsultant(ctx, payload(), { api, answer }),
    ]);
    expect(replies).toHaveLength(1);
  });

  it("под другим постом тот же человек получает свой ответ", async () => {
    const { ctx, api, replies } = setup();
    const answer = answerWith({ reply: PRICE_REPLY });
    await replyToCommentByConsultant(ctx, payload(), { api, answer });
    await replyToCommentByConsultant(
      ctx,
      {
        ...payload("Цена на 2х и семейные?", { id: "c9" }),
        post: { platformPostId: "18154195663506166" },
      },
      { api, answer },
    );
    expect(replies).toHaveLength(2);
  });

  it("на комментарий срабатывает правило Zernio — консультант молчит (Instagram даёт одно сообщение)", async () => {
    const { ctx, api, replies } = setup();
    const r = await replyToCommentByConsultant(ctx, payload(), {
      api,
      answer: answerWith({ reply: PRICE_REPLY }),
      ruleCovers: async () => true,
    });
    expect(r.note).toContain("правило Zernio");
    expect(replies).toHaveLength(0);
  });

  it("свой комментарий магазина, другой клиент без включения, клиент не v2, выключено продавцом — ничего", async () => {
    const answer = answerWith({ reply: PRICE_REPLY });
    const own = setup();
    await replyToCommentByConsultant(
      own.ctx,
      payload("Спасибо!", { author: { id: "ig-bovi", username: "bovi_kz" } }),
      { api: own.api, answer },
    );
    const other = setup({ bot: OTHER });
    await replyToCommentByConsultant(other.ctx, payload(), { api: other.api, answer });
    const v1 = setup({ servedBy: "v1" });
    await replyToCommentByConsultant(v1.ctx, payload(), { api: v1.api, answer });
    const off = setup({ settings: { consultant_comment_reply: "false" } });
    await replyToCommentByConsultant(off.ctx, payload(), { api: off.api, answer });
    for (const s of [own, other, v1, off]) expect(s.replies).toHaveLength(0);
  });

  it("другой клиент включил в настройках — отвечает", async () => {
    const { ctx, api, replies } = setup({
      bot: OTHER,
      settings: { consultant_comment_reply: "true" },
    });
    await replyToCommentByConsultant(ctx, payload(), {
      api,
      answer: answerWith({ reply: PRICE_REPLY }),
    });
    expect(replies).toHaveLength(1);
  });

  it("менеджер ведёт покупателя (пауза консультанта) — без ИИ, приглашение", async () => {
    const { ctx, db, api, replies } = setup();
    db.tables.bot_users = [
      {
        bot_id: BOVI,
        user_key: "ig_1068895099485523",
        platform: "instagram",
        telegram_id: -1,
        state: { consultant: { paused_until: new Date(Date.now() + 3600_000).toISOString() } },
        metadata: {},
      },
    ];
    const calls: string[] = [];
    await replyToCommentByConsultant(ctx, payload(), {
      api,
      answer: answerWith({ reply: PRICE_REPLY }, calls),
    });
    expect(calls).toHaveLength(0);
    expect(replies.map((x) => x.message)).toEqual([COMMENT_NEUTRAL.ru]);
  });

  it("private reply не ушёл — в журнале failed, повторно не шлём", async () => {
    const { ctx, db, api } = setup();
    (api.privateReply as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "окно 7 дней",
    });
    const answer = answerWith({ reply: PRICE_REPLY });
    await replyToCommentByConsultant(ctx, payload(), { api, answer });
    await replyToCommentByConsultant(ctx, payload(), { api, answer });
    expect(api.privateReply).toHaveBeenCalledTimes(1);
    expect(logs(db)[0]).toMatchObject({ status: "failed", error_message: "окно 7 дней" });
  });
});
