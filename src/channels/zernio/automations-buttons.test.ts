import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { DEFAULT_REPLY_PROMPT } from "@/core/instagram/comment-rules";
import {
  deliverPendingTwoStepDm,
  handleCommentReceived,
  type AutomationApi,
} from "./automations.server";

const BOT = "22222222-2222-2222-2222-222222222222";

function setup() {
  const db = fakeDb();
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "ig_comment_automations_meta",
      value: JSON.stringify({
        rule1: {
          twoStepDm: true,
          secondDmMessage: "Держите материалы",
          secondDmButtons: [
            { type: "url", title: "Открыть бота", url: "https://t.me/seller_bot" },
            { type: "postback", title: "Каталог", payload: "CATALOG" },
          ],
        },
      }),
    },
  ];
  db.tables.bot_users = [
    { bot_id: BOT, platform: "instagram", username: "anya", zernio_conversation_id: "conv-1" },
  ];
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: {
      id: BOT,
      settings: {
        zernio: { profile_id: "p-1", accounts: [{ id: "acc-1", platform: "instagram" }] },
        telegram: { username: "platform_default_bot" },
      },
      modules: { instagram: true },
    },
    db,
  } as unknown as TenantContext;
  const inbox = vi.fn(async () => ({ ok: true }));
  const api = {
    list: async () => [
      {
        id: "rule1",
        name: "Хочу",
        accountId: "acc-1",
        keywords: ["хочу"],
        dmMessage: "Привет! Сейчас пришлю",
        // Кнопки первого сообщения у самого правила Zernio — не те, что задал продавец для второго.
        buttons: [{ type: "url", title: "Zernio", url: "https://zernio.example" }],
      },
    ],
    inbox,
  } as unknown as AutomationApi;
  return { ctx, api, inbox, db };
}

describe("Comment-to-DM: второе сообщение с кнопками продавца", () => {
  it("уходят именно кнопки, которые продавец задал для второго сообщения", async () => {
    const { ctx, api, inbox, db } = setup();
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-1", text: "Хочу!", author: { id: "u-1", username: "Anya" } },
      },
      api,
      { delayMs: 0 },
    );
    expect(r.note).toBe("второе сообщение @Anya");
    expect(inbox).toHaveBeenCalledWith("conv-1", "acc-1", "Держите материалы", {
      buttons: [
        { type: "url", title: "Открыть бота", url: "https://t.me/seller_bot" },
        { type: "postback", title: "Каталог", payload: "CATALOG" },
      ],
      platform: "instagram",
    });
    expect(db.tables.zernio_logs!.map((l) => [l.event_id, l.status])).toEqual([
      ["two-step-dm:c-1", "processed"],
    ]);
  });
});

describe("Comment-to-DM: незнакомому покупателю первым не пишем", () => {
  it("диалога нет — второе сообщение ждёт ответа покупателя в очереди", async () => {
    const { ctx, api, inbox, db } = setup();
    db.tables.bot_users = [];
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-2", text: "хочу", author: { id: "u-2", username: "boris" } },
      },
      api,
      { delayMs: 0 },
    );
    expect(r.note).toBe("в очередь pending @boris");
    expect(inbox).not.toHaveBeenCalled();
    expect(db.tables.zernio_logs!.map((l) => [l.event_id, l.status, l.error_message])).toEqual([
      ["two-step-dm:c-2", "pending", "ждём ответа покупателя в Direct"],
    ]);
  });
});

describe("Comment-to-DM: первое сообщение всегда без кнопок", () => {
  it("правило с кнопками: Zernio получает текст без кнопок, кнопки — вторым сообщением", async () => {
    const { saveAutomation, getAutomationsMeta } = await import("./automations.server");
    const { ctx } = setup();
    (ctx.tenant.settings as Record<string, unknown>).zernio = {
      profile_id: "p-1",
      accounts: [{ id: "acc-1", platform: "instagram" }],
    };
    const created: Record<string, unknown>[] = [];
    const api = {
      create: async (body: Record<string, unknown>) => {
        created.push(body);
        return { id: "rule-new", ...body };
      },
    } as unknown as AutomationApi;
    const buttons = [{ type: "url" as const, title: "Бот", url: "https://t.me/seller_bot" }];
    const r = await saveAutomation(
      ctx,
      {
        accountId: "acc-1",
        profileId: "p-1",
        name: "Хочу",
        keywords: ["хочу"],
        dmMessage: "Привет! Ответьте «+», пришлю ссылку",
        buttons,
      },
      api,
    );
    expect(r).toEqual({ ok: true, id: "rule-new" });
    expect(created[0]).not.toHaveProperty("buttons");
    expect((await getAutomationsMeta(ctx))["rule-new"]).toMatchObject({
      twoStepDm: true,
      secondDmButtons: buttons,
    });
  });

  it("догоняющий private-reply правила с кнопками уходит без кнопок", async () => {
    const { sendCatchupPrivateReplies } = await import("./automations.server");
    const { ctx } = setup();
    const privateReply = vi.fn(async () => ({ ok: true }));
    const api = {
      privateReply,
      comments: async () => [{ id: "c-9", from: { username: "anya" } }],
      inbox: vi.fn(async () => ({ ok: true })),
    } as unknown as AutomationApi;
    await sendCatchupPrivateReplies(
      ctx,
      {
        postId: "p",
        accountId: "acc-1",
        commentIds: ["c-9"],
        message: "Привет",
        buttons: [{ type: "url", title: "Бот", url: "https://t.me/seller_bot" }],
      },
      api,
    );
    expect(privateReply).toHaveBeenCalledWith("p", "c-9", "acc-1", "Привет", []);
  });
});

describe("Comment-to-DM: правило в старом формате (v1) приводится к двум шагам при чтении", () => {
  const v1Rule = {
    id: "rule-v1",
    name: "Хочу",
    accountId: "acc-1",
    keywords: ["хочу"],
    dmMessage: "Держите ссылку",
    // v1 без двухшагового режима: кнопки лежат у самого правила Zernio, меты нет.
    buttons: [{ type: "url" as const, title: "Открыть бота", url: "https://t.me/seller_bot" }],
  };

  function v1Setup(servedBy: "v1" | "v2") {
    const { ctx, db } = setup();
    db.tables.app_settings = [];
    (ctx.tenant.settings as Record<string, unknown>).served_by = servedBy;
    const rules: Array<typeof v1Rule & { trigger?: string }> = [
      { ...v1Rule, buttons: [...v1Rule.buttons] },
    ];
    const update = vi.fn(async (id: string, body: Record<string, unknown>) => {
      const r = rules.find((x) => x.id === id)!;
      if (Array.isArray(body.buttons)) r.buttons = body.buttons as typeof r.buttons;
      if (typeof body.dmMessage === "string") r.dmMessage = body.dmMessage;
      return r;
    });
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = {
      list: async () => rules.map((r) => ({ ...r, buttons: [...r.buttons] })),
      update,
      inbox,
    } as unknown as AutomationApi;
    return { ctx, db, api, update, inbox, rules };
  }

  it("кнопки уходят в мету второго сообщения, у Zernio очищаются; второе сообщение уходит с ними", async () => {
    const { listAutomations, getAutomationsMeta } = await import("./automations.server");
    const { ctx, api, update, inbox, rules } = v1Setup("v2");
    const listed = await listAutomations(ctx, api);
    // Кнопки сняты, а первое сообщение просит ответить: без ответа покупателя
    // кнопки не уйдут.
    const first = `Держите ссылку\n\n${DEFAULT_REPLY_PROMPT}`;
    expect(update).toHaveBeenCalledWith("rule-v1", { buttons: [], dmMessage: first });
    expect(rules[0]!.buttons).toEqual([]);
    expect((await getAutomationsMeta(ctx))["rule-v1"]).toEqual({
      twoStepDm: true,
      secondDmButtons: v1Rule.buttons,
      replyPrompt: DEFAULT_REPLY_PROMPT,
    });
    expect(listed[0]).toMatchObject({
      twoStepDm: true,
      buttons: v1Rule.buttons,
      dmMessage: "Держите ссылку",
      firstMessage: first,
    });

    // Повторное чтение — правило уже в новом виде, Zernio больше не трогаем.
    update.mockClear();
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();

    // Комментарий: второе сообщение с кнопками из v1 — в известный диалог.
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-v1", text: "хочу", author: { id: "u-1", username: "anya" } },
      },
      api,
      { delayMs: 0 },
    );
    expect(r.note).toBe("второе сообщение @anya");
    expect(inbox).toHaveBeenCalledWith("conv-1", "acc-1", expect.any(String), {
      buttons: v1Rule.buttons,
      platform: "instagram",
    });
  });

  it("призыв не влезает в предел 1000 символов — кнопки снимаем, текст не трогаем", async () => {
    const { listAutomations, getAutomationsMeta } = await import("./automations.server");
    const { ctx, api, update, rules } = v1Setup("v2");
    rules[0]!.dmMessage = "а".repeat(990);
    await listAutomations(ctx, api);
    expect(update).toHaveBeenCalledWith("rule-v1", { buttons: [] });
    expect((await getAutomationsMeta(ctx))["rule-v1"]).toMatchObject({ replyPrompt: "" });
  });

  it("клиент ещё на v1 — правило не трогаем", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, api, update } = v1Setup("v1");
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();
  });

  it("ответ на историю не трогаем: там покупатель написал сам", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, api, update, rules } = v1Setup("v2");
    (rules[0] as Record<string, unknown>).trigger = "story_reply";
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Comment-to-DM: пересохранение правила", () => {
  function patchSetup() {
    const { ctx, db } = setup();
    db.tables.app_settings = [];
    const update = vi.fn(async (id: string, body: Record<string, unknown>) => ({ id, ...body }));
    const api = { update } as unknown as AutomationApi;
    const input = {
      id: "rule1",
      original: { platformPostId: null, postId: null, trigger: "comment" },
      accountId: "acc-1",
      profileId: "p-1",
      name: "Хочу",
      keywords: ["хочу"],
      dmMessage: "Держите ссылку",
      buttons: [{ type: "url" as const, title: "Бот", url: "https://t.me/seller_bot" }],
    };
    return { ctx, api, update, input };
  }

  it("PATCH явно очищает кнопки у Zernio и дописывает призыв ответить", async () => {
    const { saveAutomation, getAutomationsMeta } = await import("./automations.server");
    const { ctx, api, update, input } = patchSetup();
    expect(await saveAutomation(ctx, input, api)).toEqual({ ok: true, id: "rule1" });
    expect(update).toHaveBeenCalledWith(
      "rule1",
      expect.objectContaining({
        buttons: [],
        dmMessage: `Держите ссылку\n\n${DEFAULT_REPLY_PROMPT}`,
      }),
    );
    expect((await getAutomationsMeta(ctx)).rule1).toMatchObject({
      twoStepDm: true,
      replyPrompt: DEFAULT_REPLY_PROMPT,
    });
  });

  it("свой призыв продавца — вместо стандартного; пустой — без призыва; без двух шагов — без призыва", async () => {
    const { saveAutomation } = await import("./automations.server");
    const { ctx, api, update, input } = patchSetup();
    await saveAutomation(ctx, { ...input, replyPrompt: "Напишите «да»" }, api);
    expect(update.mock.calls[0]![1]).toMatchObject({
      dmMessage: "Держите ссылку\n\nНапишите «да»",
    });
    await saveAutomation(ctx, { ...input, replyPrompt: "" }, api);
    expect(update.mock.calls[1]![1]).toMatchObject({ dmMessage: "Держите ссылку", buttons: [] });
    await saveAutomation(ctx, { ...input, buttons: [], twoStepDm: false }, api);
    expect(update.mock.calls[2]![1]).toMatchObject({ dmMessage: "Держите ссылку", buttons: [] });
  });
});

describe("Comment-to-DM: второй шаг из очереди уходит один раз", () => {
  function pendingSetup() {
    const { ctx, db } = setup();
    db.tables.zernio_logs = [
      {
        id: 1,
        bot_id: BOT,
        event_id: "two-step-dm:c-5",
        event_type: "two_step_dm_pending",
        status: "pending",
        created_at: new Date().toISOString(),
        payload: { username: "boris", secondText: "Держите", buttons: [] },
      },
    ];
    return { ctx, db };
  }
  const who = { accountId: "acc-1", conversationId: "conv-9", username: "Boris" };

  it("два быстрых сообщения покупателя — второе сообщение уходит один раз", async () => {
    const { ctx, db } = pendingSetup();
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = { inbox } as unknown as AutomationApi;
    const [a, b] = await Promise.all([
      deliverPendingTwoStepDm(ctx, who, api),
      deliverPendingTwoStepDm(ctx, who, api),
    ]);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect([a, b]).toEqual([true, true]);
    expect(db.tables.zernio_logs![0]).toMatchObject({
      event_type: "two_step_dm_sent",
      status: "processed",
    });
    // Третье сообщение — очередь пуста.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("не ушло — строка возвращается в очередь до следующего ответа покупателя", async () => {
    const { ctx, db } = pendingSetup();
    const inbox = vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({
      ok: false,
      error: "rate limit",
    }));
    const api = { inbox } as unknown as AutomationApi;
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(db.tables.zernio_logs![0]).toMatchObject({
      status: "pending",
      error_message: "rate limit",
    });
    inbox.mockResolvedValueOnce({ ok: true });
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(2);
  });
});
