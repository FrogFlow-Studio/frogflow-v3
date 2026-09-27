import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer, userKey } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import {
  deliverPendingTwoStepDm,
  getAutomationsMeta,
  handleCommentReceived,
  listAutomations,
  listPostComments,
  runCommentDmFallback,
  saveAutomation,
  sendCatchupPrivateReplies,
  type AutomationApi,
  type AutomationLog,
  type CommentAutomation,
  type InstagramComment,
} from "@/channels/zernio/automations.server";
import { DEFAULT_REPLY_PROMPT } from "@/core/instagram/comment-rules";

const ACCOUNT = "acc-ig-v2-probe";
const PROFILE = "prof-ig-v2-probe";
const POST = "17900000000000001";
const ZPOST = "65f1c0a9e2b5af0012ab34cd";
const META_KEY = "ig_comment_automations_meta";
const COMMENTER = "probe_commenter_v2";
let ctx: TenantContext;
let metaBefore: string | null = null;

/* Заглушка Zernio: правила и логи в памяти, отправки — в списки. */
const store = { automations: [] as CommentAutomation[], logs: [] as AutomationLog[], seq: 0 };
const comments: InstagramComment[] = [];
const sent = {
  privateReplies: [] as string[],
  /** Текст и число кнопок каждого private-reply: `${commentId}:${кнопок}:${текст}`. */
  privateTexts: [] as string[],
  inbox: [] as string[],
  publicReplies: [] as string[],
};
let privateFails = false;
const api: AutomationApi = {
  list: async (profileId) =>
    store.automations.filter((a) => !profileId || a.profileId === profileId),
  create: async (body) => {
    const a = { ...(body as unknown as CommentAutomation), id: `auto-${++store.seq}` };
    store.automations.push(a);
    return a;
  },
  update: async (id, body) => {
    const a = store.automations.find((x) => x.id === id)!;
    Object.assign(a, body);
    return a;
  },
  remove: async (id) => {
    store.automations = store.automations.filter((x) => x.id !== id);
  },
  logs: async () => store.logs,
  comments: async () => comments,
  privateReply: async (_p, commentId, _a, message, buttons) => {
    if (privateFails)
      return { ok: false, error: "Instagram отклонил private reply (код 2534066)." };
    sent.privateReplies.push(commentId);
    sent.privateTexts.push(`${commentId}:${buttons?.length ?? 0}:${message}`);
    return { ok: true };
  },
  publicReply: async (_p, commentId) => {
    sent.publicReplies.push(commentId);
    return { ok: true };
  },
  inbox: async (conv, _a, text) => {
    sent.inbox.push(`${conv}:${text}`);
    return { ok: true };
  },
};

async function cleanup() {
  const db = serviceDb();
  await db
    .from("comment_dm_fallback_sends")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("platform_post_id", POST);
  await db
    .from("zernio_logs")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .like("event_id", "two-step-dm:c-probe-%");
  await db
    .from("bot_users")
    .delete()
    .eq("bot_id", DEMO_BOT)
    .eq("user_key", userKey("instagram", "ig-probe-commenter"));
}

describe.skipIf(!liveReady)("Comment-to-DM Instagram на демо-клиенте", () => {
  beforeAll(async () => {
    const tenant = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({
      ...tenant,
      modules: { ...tenant.modules, instagram: true },
      settings: {
        ...tenant.settings,
        telegram: { username: "demo_probe_bot", webhook_ok: false },
        zernio: {
          ...tenant.settings.zernio,
          profile_id: PROFILE,
          accounts: [
            { id: ACCOUNT, platform: "instagram", username: "probe_shop", expired: false },
          ],
        },
      },
    });
    await cleanup();
    metaBefore = await getSetting(ctx, META_KEY);
  });
  afterAll(async () => {
    if (metaBefore !== null) await setSetting(ctx, META_KEY, metaBefore);
    else await serviceDb().from("app_settings").delete().eq("bot_id", DEMO_BOT).eq("key", META_KEY);
    await cleanup();
  });

  it("сохранение: чужой аккаунт — отказ, все посты без слов — отказ, PATCH и пересоздание", async () => {
    const base = {
      accountId: ACCOUNT,
      name: "Проба",
      dmMessage: "Привет! Материалы тут.",
      keywords: ["хочу"],
    };
    expect((await saveAutomation(ctx, { ...base, accountId: "acc-else" }, api)).ok).toBe(false);
    expect((await saveAutomation(ctx, { ...base, keywords: [] }, api)).ok).toBe(false);
    expect(
      (await saveAutomation(ctx, { ...base, platformPostId: POST, postId: POST }, api)).ok,
    ).toBe(false);

    const created = await saveAutomation(
      ctx,
      {
        ...base,
        platformPostId: POST,
        postId: ZPOST,
        twoStepDm: true,
        buttons: [{ type: "url", title: "Бот", url: "https://t.me/demo_probe_bot" }],
        secondDmMessage: "Жмите кнопку",
        unresolvedPrompt: "Напишите нам в директ",
      },
      api,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stored = store.automations.find((a) => a.id === created.id)!;
    expect(stored.profileId).toBe(PROFILE);
    expect(stored).not.toHaveProperty("buttons"); // двухшаговый режим: первое без кнопок
    expect(stored).not.toHaveProperty("twoStepDm");
    // Первое сообщение просит ответить: без ответа второе с кнопками не уйдёт.
    expect(stored.dmMessage).toBe(`Привет! Материалы тут.\n\n${DEFAULT_REPLY_PROMPT}`);
    const meta = await getAutomationsMeta(ctx);
    expect(meta[created.id]).toMatchObject({
      twoStepDm: true,
      secondDmMessage: "Жмите кнопку",
      unresolvedPrompt: "Напишите нам в директ",
    });
    expect(meta[created.id]?.secondDmButtons?.[0]?.url).toBe("https://t.me/demo_probe_bot");

    const listed = await listAutomations(ctx, api);
    expect(listed.map((a) => a.id)).toEqual([created.id]);
    expect(listed[0]?.twoStepDm).toBe(true);
    expect(listed[0]?.buttons?.[0]?.title).toBe("Бот");
    // В форме — текст продавца без призыва.
    expect(listed[0]?.dmMessage).toBe("Привет! Материалы тут.");

    // Тот же пост — PATCH, id сохраняется.
    const patched = await saveAutomation(
      ctx,
      {
        ...base,
        id: created.id,
        original: { platformPostId: POST, postId: ZPOST },
        platformPostId: POST,
        postId: ZPOST,
        dmMessage: "Обновлённый текст",
      },
      api,
    );
    expect(patched).toEqual({ ok: true, id: created.id });
    expect(store.automations.find((a) => a.id === created.id)?.dmMessage).toBe("Обновлённый текст");
    // PATCH явно очищает кнопки: поле, которого нет в PATCH, Zernio не меняет.
    expect(store.automations.find((a) => a.id === created.id)?.buttons).toEqual([]);
    expect((await getAutomationsMeta(ctx))[created.id]?.twoStepDm).toBe(false);

    // Смена поста — пересоздание, старое удалено вместе с мета.
    const moved = await saveAutomation(
      ctx,
      {
        ...base,
        id: created.id,
        original: { platformPostId: POST, postId: ZPOST },
        platformPostId: null,
        postId: null,
        keywords: ["год"],
      },
      api,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.id).not.toBe(created.id);
    expect(store.automations.map((a) => a.id)).toEqual([moved.id]);
    expect((await getAutomationsMeta(ctx))[created.id]).toBeUndefined();
    store.automations = [];
    await setSetting(ctx, META_KEY, "{}");
  });

  it("comment.received: второе сообщение или очередь pending, доставка при первом DM", async () => {
    const r = await saveAutomation(
      ctx,
      {
        accountId: ACCOUNT,
        name: "Двухшаговое",
        dmMessage: "Первое",
        keywords: ["хочу"],
        platformPostId: POST,
        postId: ZPOST,
        twoStepDm: true,
        secondDmMessage: "Второе с кнопкой",
      },
      api,
    );
    expect(r.ok).toBe(true);
    const payload = (id: string, text: string, username = COMMENTER) => ({
      account: { accountId: ACCOUNT, username: "probe_shop" },
      comment: { id, text, platformPostId: POST, author: { id: "u1", username } },
    });
    expect(
      (
        await handleCommentReceived(ctx, payload("c-probe-0", "хочу", "probe_shop"), api, {
          delayMs: 0,
        })
      ).note,
    ).toMatch(/самого аккаунта/);
    expect(
      (await handleCommentReceived(ctx, payload("c-probe-1", "спасибо"), api, { delayMs: 0 })).note,
    ).toMatch(/не совпало/);

    // Диалога с покупателем нет — написать первым в Instagram нельзя: в очередь.
    const queued = await handleCommentReceived(ctx, payload("c-probe-2", "Хочу!"), api, {
      delayMs: 0,
    });
    expect(queued.note).toMatch(/pending/);
    const { data: row } = await ctx.db
      .from("zernio_logs")
      .select("event_type, status")
      .eq("event_id", "two-step-dm:c-probe-2")
      .single();
    expect(row).toEqual({ event_type: "two_step_dm_pending", status: "pending" });
    // Повтор того же события — не шлём второй раз, но и не «processed».
    expect(
      (await handleCommentReceived(ctx, payload("c-probe-2", "Хочу!"), api, { delayMs: 0 })).note,
    ).toMatch(/pending/);

    // Покупатель написал первым — второе уходит в открывшийся диалог.
    expect(
      await deliverPendingTwoStepDm(
        ctx,
        { accountId: ACCOUNT, conversationId: "conv-1", username: "someone_else" },
        api,
      ),
    ).toBe(false);
    expect(
      await deliverPendingTwoStepDm(
        ctx,
        { accountId: ACCOUNT, conversationId: "conv-1", username: COMMENTER.toUpperCase() },
        api,
      ),
    ).toBe(true);
    expect(sent.inbox.at(-1)).toBe("conv-1:Второе с кнопкой");
    const { data: done } = await ctx.db
      .from("zernio_logs")
      .select("event_type, status")
      .eq("event_id", "two-step-dm:c-probe-2")
      .single();
    expect(done).toEqual({ event_type: "two_step_dm_sent", status: "processed" });
    expect(
      await deliverPendingTwoStepDm(
        ctx,
        { accountId: ACCOUNT, conversationId: "conv-1", username: COMMENTER },
        api,
      ),
    ).toBe(false);

    // Незнакомый покупатель — снова очередь: в Direct ничего не уходит.
    const inboxBefore = sent.inbox.length;
    expect(
      (await handleCommentReceived(ctx, payload("c-probe-3", "хочу"), api, { delayMs: 0 })).note,
    ).toMatch(/pending/);
    expect(sent.inbox.length).toBe(inboxBefore);
    const { data: queued3 } = await ctx.db
      .from("zernio_logs")
      .select("status, error_message")
      .eq("event_id", "two-step-dm:c-probe-3")
      .single();
    expect(queued3).toEqual({
      status: "pending",
      error_message: "ждём ответа покупателя в Direct",
    });
  });

  it("резервный крон: пропущенный комментарий получает DM, статусы в панели, эскалация", async () => {
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    comments.length = 0;
    comments.push(
      {
        id: "c-probe-10",
        message: "хочу",
        createdTime: ago(3_600_000),
        from: { id: "u10", username: "u10" },
      },
      {
        id: "c-probe-11",
        message: "хочу",
        createdTime: ago(60_000),
        from: { id: "u11", username: "u11" },
      }, // слишком новый
      {
        id: "c-probe-12",
        message: "просто спасибо",
        createdTime: ago(3_600_000),
        from: { id: "u12" },
      },
      {
        id: "c-probe-13",
        message: "хочу",
        createdTime: ago(3_600_000),
        from: { id: "u13", isOwner: true },
      },
      { id: "c-probe-14", message: "хочу", createdTime: ago(3_600_000), from: { id: "u14" } }, // Zernio уже отправил
      {
        id: "c-probe-15",
        message: "хочу",
        createdTime: ago(3_600_000),
        from: { id: "u15" },
        parentId: "c-probe-10",
      },
    );
    store.logs = [{ commentId: "c-probe-14", status: "sent" }];

    const annotated = await listPostComments(ctx, POST, ACCOUNT, api);
    expect(annotated.automation?.platformPostId).toBe(POST);
    expect(Object.fromEntries(annotated.comments.map((c) => [c.id, c.replyStatus]))).toEqual({
      "c-probe-10": "missing",
      "c-probe-11": "missing",
      "c-probe-12": "no_match",
      "c-probe-13": "owner",
      "c-probe-14": "sent",
      "c-probe-15": "missing",
    });
    expect(annotated.comments.find((c) => c.id === "c-probe-15")?.blockReason).toBe("nested");

    sent.privateReplies = [];
    sent.privateTexts = [];
    sent.inbox = [];
    const r1 = await runCommentDmFallback(ctx, api, now);
    expect(r1).toMatchObject({ automationsChecked: 1, sent: 1, failed: 0 });
    expect(sent.privateReplies).toEqual(["c-probe-10"]);
    // Первое — без кнопок и с призывом ответить.
    expect(sent.privateTexts).toEqual([`c-probe-10:0:Первое\n\n${DEFAULT_REPLY_PROMPT}`]);
    // Двухшаговое: диалога с u10 нет — второе ждёт его ответа, в Direct ничего не ушло.
    expect(sent.inbox).toEqual([]);
    const { data: queued10 } = await ctx.db
      .from("zernio_logs")
      .select("status")
      .eq("event_id", "two-step-dm:c-probe-10")
      .single();
    expect(queued10).toEqual({ status: "pending" });
    const { data: sends } = await ctx.db
      .from("comment_dm_fallback_sends")
      .select("comment_id, status")
      .eq("platform_post_id", POST);
    expect(sends).toEqual([{ comment_id: "c-probe-10", status: "sent" }]);

    // Повторный прогон — строка уже есть, второй раз не шлём.
    const r2 = await runCommentDmFallback(ctx, api, now);
    expect(r2.sent).toBe(0);
    expect(sent.privateReplies).toEqual(["c-probe-10"]);

    // Private-reply падает: альт-канал в существующий диалог, публичный ответ, иначе просьба написать.
    privateFails = true;
    comments.push({
      id: "c-probe-20",
      message: "хочу",
      createdTime: ago(3_600_000),
      from: { id: "ig-probe-commenter", username: COMMENTER },
    });
    comments.push({
      id: "c-probe-21",
      message: "хочу",
      createdTime: ago(3_600_000),
      from: { id: "nobody-known", username: "nobody" },
    });
    await upsertCustomer(ctx, "instagram", "ig-probe-commenter", {
      username: COMMENTER,
      zernioConversationId: "conv-known",
      zernioAccountId: ACCOUNT,
    });
    await api.update(store.automations[0]!.id!, { commentReply: "Ответили в директ 💬" });
    await import("@/channels/zernio/automations.server").then((m) =>
      m.setAutomationMeta(ctx, store.automations[0]!.id!, {
        unresolvedPrompt: "Напишите нам первыми",
      }),
    );
    sent.inbox = [];
    sent.publicReplies = [];
    const r3 = await runCommentDmFallback(ctx, api, now);
    privateFails = false;
    expect(r3.failed).toBe(2);
    expect(sent.inbox).toEqual(["conv-known:Первое"]);
    expect(sent.publicReplies).toEqual(["c-probe-20", "c-probe-21"]); // ответ у 20, просьба у 21
    const { data: rows } = await ctx.db
      .from("comment_dm_fallback_sends")
      .select("comment_id, status, alt_channel_status, comment_reply_status, comment_reply_error")
      .in("comment_id", ["c-probe-20", "c-probe-21"])
      .order("comment_id");
    expect(rows).toEqual([
      {
        comment_id: "c-probe-20",
        status: "sent",
        alt_channel_status: "sent",
        comment_reply_status: "sent",
        comment_reply_error: null,
      },
      {
        comment_id: "c-probe-21",
        status: "failed",
        alt_channel_status: "skipped",
        comment_reply_status: "skipped",
        comment_reply_error: "prompt_sent",
      },
    ]);
  });

  it("догоняющая рассылка: последовательно, потолок 25, двухшаговая — второе сообщение", async () => {
    sent.privateReplies = [];
    sent.inbox = [];
    const results = await sendCatchupPrivateReplies(
      ctx,
      {
        postId: POST,
        accountId: ACCOUNT,
        commentIds: ["c-probe-10", "c-probe-12"],
        message: "Догоняем",
        twoStepDm: true,
        secondDmMessage: "И кнопка",
      },
      api,
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(sent.privateReplies).toEqual(["c-probe-10", "c-probe-12"]);
    // Диалога нет — второе ждёт ответа покупателя в очереди, в Direct ничего не ушло.
    expect(sent.inbox).toEqual([]);
    const { data: pending } = await ctx.db
      .from("zernio_logs")
      .select("status, payload")
      .eq("event_id", "two-step-dm:c-probe-10")
      .single();
    expect(pending?.status).toBe("pending");
    expect((pending?.payload as { secondText?: string }).secondText).toBe("И кнопка");
    await expect(
      sendCatchupPrivateReplies(
        ctx,
        { postId: POST, accountId: "acc-else", commentIds: ["x"], message: "x" },
        api,
      ),
    ).rejects.toThrow(/Чужой/);
  });
});
