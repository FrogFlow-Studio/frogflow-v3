import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { DEFAULT_REPLY_PROMPT } from "@/core/instagram/comment-rules";
import {
  TWO_STEP_CLAIM_STALE_MS,
  TWO_STEP_MAX_ATTEMPTS,
  deliverPendingTwoStepDm,
  deliverTwoStepFromDm,
  deliverTwoStepForDmKeyword,
  twoStepJustDelivered,
  handleCommentReceived,
  type AutomationApi,
} from "./automations.server";

const BOT = "22222222-2222-2222-2222-222222222222";

/** Строки второго шага (без отметки «одно второе на покупателя»). */
const secondSteps = (db: ReturnType<typeof fakeDb>) =>
  db.tables.zernio_logs!.filter((l) => String(l.event_id).startsWith("two-step-dm:"));

function setup() {
  const db = fakeDb({ unique: { zernio_logs: [["bot_id", "event_id"]] } });
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
    expect(secondSteps(db).map((l) => [l.event_id, l.status])).toEqual([
      ["two-step-dm:c-1", "processed"],
    ]);
  });
});

describe("резерв Comment-to-DM в существующий диалог", () => {
  it("одна обычная отправка; при отказе повтора с тегом HUMAN_AGENT нет", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const { sendAltChannel } = await import("./automations.server");
    const api = {
      inbox: async (_c: string, _a: string, _t: string, opts?: Record<string, unknown>) => {
        calls.push(opts);
        return { ok: false, error: "окно 24 часа закрыто" };
      },
    } as unknown as Pick<AutomationApi, "inbox">;
    const r = await sendAltChannel(api, "conv-1", {
      accountId: "acc-1",
      dmMessage: "Привет",
      buttons: [{ type: "postback", title: "Каталог", payload: "CATALOG" }],
    });
    expect(r).toEqual({ status: "failed", error: "окно 24 часа закрыто" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty("messagingType");
    expect(calls[0]).not.toHaveProperty("messageTag");
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
    expect(secondSteps(db).map((l) => [l.event_id, l.status, l.error_message])).toEqual([
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

  it("несколько вариантов публичного ответа уходят в Zernio; пустой список их снимает (просьба Кристины Дидактики)", async () => {
    const { saveAutomation } = await import("./automations.server");
    const { ctx, api, update, input } = patchSetup();
    const replies = {
      commentReply: "Написали вам в директ 💬",
      commentReplyVariations: ["Ответили в личные 📩", "Проверьте директ ✨"],
    };
    expect(await saveAutomation(ctx, { ...input, ...replies }, api)).toEqual({
      ok: true,
      id: "rule1",
    });
    expect(update).toHaveBeenLastCalledWith("rule1", expect.objectContaining(replies));
    await saveAutomation(ctx, { ...input, ...replies, commentReplyVariations: [] }, api);
    expect(update).toHaveBeenLastCalledWith(
      "rule1",
      expect.objectContaining({ commentReplyVariations: [] }),
    );
  });

  it("запасной публичный ответ берёт основной или вариант, пустые пропускает", async () => {
    const { pickCommentReply } = await import("./automations.server");
    const a = { commentReply: "Первый", commentReplyVariations: [" ", "Второй", "Третий"] };
    expect(pickCommentReply(a, () => 0)).toBe("Первый");
    expect(pickCommentReply(a, () => 0.5)).toBe("Второй");
    expect(pickCommentReply(a, () => 0.99)).toBe("Третий");
    expect(pickCommentReply({ commentReply: "" }, () => 0)).toBe("");
  });

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

describe("Comment-to-DM: быстрая покупка вместо второго сообщения с «Купить»", () => {
  function buySetup(buttons: unknown[]) {
    const { ctx, db } = setup();
    db.tables.zernio_logs = [
      {
        id: 1,
        bot_id: BOT,
        event_id: "two-step-dm:c-7",
        event_type: "two_step_dm_pending",
        status: "pending",
        created_at: new Date().toISOString(),
        payload: { username: "boris", secondText: "Палитра — жмите «Купить»", buttons },
      },
    ];
    return { ctx, db };
  }
  const buy = { type: "postback", title: "Купить", payload: "PROD:p-1" };

  it("«+» на правило с «Купить» — сразу заказ магазином, второе сообщение не уходит; повторный «+» — ничего", async () => {
    const { ctx, db } = buySetup([buy]);
    const inbox = vi.fn(async () => ({ ok: true }));
    const express = vi.fn(async (_id: string) => true);
    const api = { inbox } as unknown as AutomationApi;
    const who = { accountId: "acc-1", conversationId: "conv-7", username: "boris", express };
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(express).toHaveBeenCalledWith("p-1");
    expect(inbox).not.toHaveBeenCalled();
    expect(db.tables.zernio_logs![0]).toMatchObject({
      event_type: "two_step_dm_sent",
      status: "processed",
      payload: expect.objectContaining({ express: "p-1" }),
    });
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(express).toHaveBeenCalledTimes(1);
  });

  it("быстрая покупка выключена (false) — уходит обычное второе сообщение с «Купить»", async () => {
    const { ctx } = buySetup([buy]);
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = { inbox } as unknown as AutomationApi;
    const who = {
      accountId: "acc-1",
      conversationId: "conv-7",
      username: "boris",
      express: async () => false,
    };
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(inbox.mock.calls[0]).toEqual(expect.arrayContaining(["Палитра — жмите «Купить»"]));
  });

  it("упала посреди — второе сообщение вдогонку не шлём (могла уже написать покупателю)", async () => {
    const { ctx, db } = buySetup([buy]);
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = { inbox } as unknown as AutomationApi;
    const who = {
      accountId: "acc-1",
      conversationId: "conv-7",
      username: "boris",
      express: async () => {
        throw new Error("сбой");
      },
    };
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(inbox).not.toHaveBeenCalled();
    expect(db.tables.zernio_logs![0]).toMatchObject({ status: "processed" });
  });

  it("без «Купить» или с двумя товарами — обычное второе сообщение", async () => {
    for (const buttons of [
      [{ type: "url", title: "Сайт", url: "https://x.kz" }],
      [buy, { type: "postback", title: "Ещё", payload: "PROD:p-2" }],
    ]) {
      const { ctx } = buySetup(buttons);
      const inbox = vi.fn(async () => ({ ok: true }));
      const express = vi.fn(async () => true);
      const api = { inbox } as unknown as AutomationApi;
      const who = { accountId: "acc-1", conversationId: "conv-7", username: "boris", express };
      expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
      expect(express).not.toHaveBeenCalled();
      expect(inbox).toHaveBeenCalledTimes(1);
    }
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

  it("«+» вдогонку ко второму сообщению узнаётся, набранное после него — нет", async () => {
    const { ctx, db } = pendingSetup();
    const api = { inbox: vi.fn(async () => ({ ok: true })) } as unknown as AutomationApi;
    const before = new Date(Date.now() - 1000).toISOString();
    expect(await twoStepJustDelivered(ctx, "boris", before)).toBe(false);
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    // Очередь уже пуста: второму «+» deliverPending ответит false.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    // «+» написан до того, как второе сообщение ушло, — вдогонку.
    expect(await twoStepJustDelivered(ctx, "Boris", before)).toBe(true);
    expect(await twoStepJustDelivered(ctx, "anya", before)).toBe(false);
    // Набрано после второго сообщения (или время не известно) — обычное сообщение.
    const after = new Date(Date.now() + 1000).toISOString();
    expect(await twoStepJustDelivered(ctx, "boris", after)).toBe(false);
    expect(await twoStepJustDelivered(ctx, "boris", null)).toBe(false);
    // Пока второе сообщение отправляется — любой «+» вдогонку.
    const row = db.tables.zernio_logs![0]!;
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    Object.assign(row, {
      status: "processing",
      error_message: `claim:${new Date().toISOString()}:1`,
    });
    expect(await twoStepJustDelivered(ctx, "boris", after)).toBe(true);
    // Зависший захват и отправка несколько минут назад — снова обычное сообщение.
    row.error_message = `claim:${tenMinAgo}:1`;
    expect(await twoStepJustDelivered(ctx, "boris", before)).toBe(false);
    Object.assign(row, {
      status: "processed",
      error_message: null,
      payload: { ...(row.payload as object), sent_at: tenMinAgo },
    });
    expect(
      await twoStepJustDelivered(ctx, "boris", new Date(Date.now() - 20 * 60_000).toISOString()),
    ).toBe(false);
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

describe("Comment-to-DM: правило с кнопками без меты — всё равно два шага", () => {
  it("мета не записалась, кнопки остались у Zernio — второе сообщение уходит с ними", async () => {
    const { ctx, api, inbox, db } = setup();
    db.tables.app_settings = [];
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-7", text: "хочу", author: { id: "u-1", username: "anya" } },
      },
      api,
      { delayMs: 0 },
    );
    expect(r.note).toBe("второе сообщение @anya");
    expect(inbox).toHaveBeenCalledWith("conv-1", "acc-1", expect.any(String), {
      buttons: [{ type: "url", title: "Zernio", url: "https://zernio.example" }],
      platform: "instagram",
    });
  });
});

describe("Comment-to-DM: зависший захват второго шага", () => {
  const T0 = Date.parse("2026-09-27T12:00:00Z");
  const who = { accountId: "acc-1", conversationId: "conv-9", username: "boris" };
  function stuck(minutesAgo: number, attempts = 1) {
    const { ctx, db } = setup();
    const at = new Date(T0 - minutesAgo * 60_000).toISOString();
    db.tables.zernio_logs = [
      {
        id: 1,
        bot_id: BOT,
        event_id: "two-step-dm:c-5",
        event_type: "two_step_dm_pending",
        status: "processing",
        error_message: `claim:${at}:${attempts}`,
        created_at: new Date(T0 - 3_600_000).toISOString(),
        payload: { username: "boris", secondText: "Держите", buttons: [], attempts },
      },
    ];
    return { ctx, db, row: db.tables.zernio_logs[0]! };
  }
  const api = (tail: () => Promise<unknown[]>, ok = true) => {
    const inbox = vi.fn(async (): Promise<{ ok: boolean; error?: string }> =>
      ok ? { ok: true } : { ok: false, error: "rate limit" },
    );
    return { inbox, api: { inbox, tail } as unknown as AutomationApi };
  };
  const now = () => new Date(T0);
  // Хвост прочитан, второго сообщения в нём нет — только «+» покупателя.
  const buyerPlus = [
    { direction: "incoming", message: "+", createdAt: new Date(T0).toISOString() },
  ];

  it("свежий захват — соседний вебхук ещё шлёт, второй раз не шлём", async () => {
    const { ctx, row } = stuck(1);
    const a = api(async () => buyerPlus);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(true);
    expect(a.inbox).not.toHaveBeenCalled();
    expect(row.status).toBe("processing");
  });

  it("процесс умер до отправки — после срока строку забирают снова, попытка вторая", async () => {
    const { ctx, row } = stuck(TWO_STEP_CLAIM_STALE_MS / 60_000 + 1);
    const a = api(async () => [
      { direction: "incoming", message: "+", createdAt: new Date(T0).toISOString() },
    ]);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(true);
    expect(a.inbox).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: "processed", event_type: "two_step_dm_sent" });
    expect((row.payload as { attempts: number }).attempts).toBe(2);
  });

  it("процесс умер после отправки — сообщение уже в переписке, второй раз не шлём", async () => {
    const { ctx, row } = stuck(10);
    const a = api(async () => [
      {
        direction: "outgoing",
        message: "Держите",
        createdAt: new Date(T0 - 9 * 60_000).toISOString(),
      },
    ]);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(true);
    expect(a.inbox).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: "processed", event_type: "two_step_dm_sent" });
  });

  it("переписку прочитать не удалось — не шлём вслепую, строка ждёт", async () => {
    const { ctx, row } = stuck(10);
    const a = api(async () => {
      throw new Error("Zernio down");
    });
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(false);
    expect(a.inbox).not.toHaveBeenCalled();
    expect(row.status).toBe("processing");
  });

  it("хвост пустой — ушло ли, неизвестно: не шлём, строка ждёт", async () => {
    const { ctx, row } = stuck(10);
    const a = api(async () => []);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(false);
    expect(a.inbox).not.toHaveBeenCalled();
    expect(row.status).toBe("processing");
  });

  it("предел попыток: зависшая строка после последней — failed, без отправки", async () => {
    const { ctx, row } = stuck(10, TWO_STEP_MAX_ATTEMPTS);
    const a = api(async () => buyerPlus);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(false);
    expect(a.inbox).not.toHaveBeenCalled();
    expect(row.status).toBe("failed");
  });

  it("предел попыток: неудачная последняя отправка — failed, а не снова в очередь", async () => {
    const { ctx, row } = stuck(10, TWO_STEP_MAX_ATTEMPTS - 1);
    const a = api(async () => buyerPlus, false);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(false);
    expect(a.inbox).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: "failed", error_message: "rate limit" });
  });

  it("повтор идёт с тем же ключом идемпотентности, что и первая попытка", async () => {
    const { ctx, row } = stuck(10);
    const a = api(async () => buyerPlus, false);
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(false);
    row.status = "processing";
    row.error_message = `claim:${new Date(T0 - 10 * 60_000).toISOString()}:2`;
    a.inbox.mockResolvedValueOnce({ ok: true });
    expect(await deliverPendingTwoStepDm(ctx, who, a.api, now)).toBe(true);
    const keys = a.inbox.mock.calls.map(
      (c) =>
        (c as unknown as [string, string, string, { idempotencyScope?: string }])[3]
          .idempotencyScope,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("пока шла отправка, строку перехватили — чужой захват не затираем", async () => {
    const { ctx, row } = stuck(10);
    const other = `claim:${new Date(T0).toISOString()}:3`;
    const inbox = vi.fn(async () => {
      row.error_message = other;
      return { ok: true };
    });
    const tail = async () => buyerPlus;
    await deliverPendingTwoStepDm(ctx, who, { inbox, tail } as unknown as AutomationApi, now);
    expect(row).toMatchObject({ status: "processing", error_message: other });
  });

  it("уже ушло, но строку тем временем перехватили — отметку не ставим поверх", async () => {
    const { ctx, row } = stuck(10);
    const other = `claim:${new Date(T0).toISOString()}:3`;
    const tail = async () => {
      row.error_message = other;
      return [
        {
          direction: "outgoing",
          message: "Держите",
          createdAt: new Date(T0 - 9 * 60_000).toISOString(),
        },
      ];
    };
    const a = api(tail);
    await deliverPendingTwoStepDm(ctx, who, a.api, now);
    expect(row).toMatchObject({ status: "processing", error_message: other });
  });

  it("два вебхука перехватывают зависшую строку одновременно — отправка одна", async () => {
    const { ctx } = stuck(10);
    const a = api(async () => buyerPlus);
    await Promise.all([
      deliverPendingTwoStepDm(ctx, who, a.api, now),
      deliverPendingTwoStepDm(ctx, who, a.api, now),
    ]);
    expect(a.inbox).toHaveBeenCalledTimes(1);
  });
});

describe("Comment-to-DM: «+» раньше вебхука комментария (Кристина Дидактика, обращение #25)", () => {
  const who = { accountId: "acc-1", conversationId: "conv-1", username: "Anya" };
  const firstDm = `Привет! Сейчас пришлю\n\n${DEFAULT_REPLY_PROMPT}`;
  function dmSetup(tail: Array<Record<string, unknown>>) {
    const { ctx, db } = setup();
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = {
      list: async () => [
        { id: "rule1", name: "Хочу", accountId: "acc-1", keywords: ["хочу"], dmMessage: firstDm },
      ],
      inbox,
      tail: vi.fn(async () => tail),
    } as unknown as AutomationApi;
    return { ctx, db, api, inbox };
  }
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it("первое сообщение правила в переписке — второе уходит на этот «+», вебхук потом не дублирует", async () => {
    const { ctx, db, api, inbox } = dmSetup([
      { id: "m-1", direction: "outgoing", message: firstDm, createdAt: at(20_000) },
      { id: "m-2", direction: "incoming", message: "+", createdAt: at(1_000) },
    ]);
    // Очереди ещё нет: вебхук комментария не дошёл.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      "Держите материалы",
      expect.objectContaining({
        buttons: [
          { type: "url", title: "Открыть бота", url: "https://t.me/seller_bot" },
          { type: "postback", title: "Каталог", payload: "CATALOG" },
        ],
      }),
    );
    expect(secondSteps(db).map((l) => [l.event_id, l.status])).toEqual([
      ["two-step-dm:dm:m-1", "processed"],
    ]);
    // Вебхук комментария дошёл позже — второй раз не шлёт.
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-9", text: "хочу", author: { id: "u-1", username: "anya" } },
      },
      api,
      { delayMs: 0 },
    );
    expect(r.note).toBe("второе сообщение @anya");
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("два «+» одновременно — второе сообщение одно", async () => {
    const { ctx, api, inbox } = dmSetup([
      { id: "m-1", direction: "outgoing", message: firstDm, createdAt: at(20_000) },
    ]);
    const res = await Promise.all([
      deliverTwoStepFromDm(ctx, who, api),
      deliverTwoStepFromDm(ctx, who, api),
    ]);
    expect(res).toEqual([true, true]);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("вебхук комментария завёл свою строку одновременно с «+» — «Купить» не присылает второе ещё раз", async () => {
    const { ctx, db, api, inbox } = dmSetup([]);
    // Гонка: «+» и вебхук комментария не увидели строки друг друга — в очереди обе.
    const row = (id: string, eventId: string, msAgo: number) => ({
      id,
      bot_id: BOT,
      event_id: eventId,
      event_type: "two_step_dm_pending",
      status: "pending",
      created_at: at(msAgo),
      payload: { username: "anya", automationId: "rule1", secondText: "Держите", buttons: [] },
    });
    db.tables.zernio_logs!.push(
      row("row-webhook", "two-step-dm:c-7", 5_000),
      row("row-dm", "two-step-dm:dm:m-1", 4_000),
    );
    // «+» — второе сообщение уходит.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    // Следующее сообщение покупателя («Купить») — второе сообщение не повторяется.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(secondSteps(db).map((l) => l.status)).toEqual(["processed", "processed"]);
  });

  it("после первого уже было другое исходящее, или первое давнее — «+» не трогаем", async () => {
    const after = dmSetup([
      { id: "m-1", direction: "outgoing", message: firstDm, createdAt: at(60_000) },
      { id: "m-2", direction: "outgoing", message: "Держите материалы", createdAt: at(50_000) },
    ]);
    expect(await deliverTwoStepFromDm(after.ctx, who, after.api)).toBe(false);
    const old = dmSetup([
      { id: "m-1", direction: "outgoing", message: firstDm, createdAt: at(2 * 3600_000) },
    ]);
    expect(await deliverTwoStepFromDm(old.ctx, who, old.api)).toBe(false);
    const other = dmSetup([
      { id: "m-1", direction: "outgoing", message: "Здравствуйте", createdAt: at(10_000) },
    ]);
    expect(await deliverTwoStepFromDm(other.ctx, who, other.api)).toBe(false);
    expect(after.inbox).not.toHaveBeenCalled();
    expect(old.inbox).not.toHaveBeenCalled();
    expect(other.inbox).not.toHaveBeenCalled();
  });
});

describe("Comment-to-DM: одно второе сообщение покупателю (Кристина Дидактика, 07.10, тест 19:33)", () => {
  const firstDm = `привет, вот товар\n\n${DEFAULT_REPLY_PROMPT}`;
  const who = { accountId: "acc-1", conversationId: "conv-7", username: "fro5654" };
  function twoRules() {
    const { ctx, db } = setup();
    // Покупатель ещё не известен по имени: вебхук комментария ставит второе в очередь.
    db.tables.bot_users = [];
    db.tables.app_settings = [
      {
        bot_id: BOT,
        key: "ig_comment_automations_meta",
        value: JSON.stringify({
          general: { twoStepDm: true, secondDmMessage: "Держите" },
          reel: {
            twoStepDm: true,
            secondDmButtons: [{ type: "postback", title: "Купить", payload: "PROD:p-1" }],
          },
        }),
      },
    ];
    const tail: Array<Record<string, unknown>> = [];
    const inbox = vi.fn(async (_c: string, _a: string, text: string) => {
      tail.push({ id: `out-${tail.length}`, direction: "outgoing", message: text });
      return { ok: true };
    });
    const api = {
      // Два правила на один пост: общее (любой пост) первым в списке, и правило рилса.
      list: async () => [
        {
          id: "general",
          name: "Общее",
          accountId: "acc-1",
          keywords: ["хочу"],
          dmMessage: "Привет",
        },
        {
          id: "reel",
          name: "Рилс",
          accountId: "acc-1",
          keywords: ["хочу"],
          dmMessage: firstDm,
          platformPostId: "ig-reel-1",
        },
      ],
      inbox,
      tail: vi.fn(async () => tail),
    } as unknown as AutomationApi;
    const first = () =>
      tail.push({
        id: "m-first",
        direction: "outgoing",
        message: firstDm,
        createdAt: new Date(Date.now() - 15_000).toISOString(),
      });
    return { ctx, db, api, inbox, first };
  }
  const comment = (id: string, author = { id: "u-7", username: "fro5654" }) => ({
    account: { id: "acc-1" },
    post: { platformPostId: "ig-reel-1" },
    comment: { id, text: "хочу", author },
  });
  /** Вебхук комментария: created_at в базе ставит default — тестовая база его не знает. */
  async function commentWebhook(
    ctx: TenantContext,
    api: AutomationApi,
    id: string,
    author?: { id: string; username: string },
  ) {
    await handleCommentReceived(ctx, comment(id, author), api, { delayMs: 0 });
    for (const l of (ctx.db as unknown as ReturnType<typeof fakeDb>).tables.zernio_logs!)
      l.created_at ??= new Date().toISOString();
  }

  it("комментарий → «+» → запоздавший вебхук комментария → «Купить»: второе уходит один раз", async () => {
    const { ctx, db, api, inbox, first } = twoRules();
    // 1. Комментарий: первое сообщение шлёт сам Zernio — оно в переписке.
    first();
    // 2. «+»: очереди нет, второе — по первому сообщению в переписке.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    // 3. Вебхук комментария пришёл позже и выбрал другое правило — ставит своё в очередь.
    await commentWebhook(ctx, api, "c-33");
    expect(secondSteps(db).map((l) => l.status)).toEqual(["processed", "pending"]);
    // 4. «Купить»: строка из очереди закрывается без отправки, сообщение идёт магазину.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(secondSteps(db).map((l) => l.status)).toEqual(["processed", "processed"]);
  });

  it("как в журнале 19:29: вебхук комментария → «+» с цифровым id вместо имени → «Купить» с именем — второе одно", async () => {
    const { ctx, db, api, inbox, first } = twoRules();
    // 19:29:05 — вебхук комментария: покупатель ещё не известен, второе в очередь.
    first();
    await commentWebhook(ctx, api, "c-29", { username: "dolphin.2023841", id: "1407411881513987" });
    expect(secondSteps(db).map((l) => l.status)).toEqual(["pending"]);
    // 19:29:53 — «+»: Zernio прислал вместо имени цифровой id.
    const plus = {
      accountId: "acc-1",
      conversationId: "conv-29",
      username: "1407411881513987",
      senderId: "1407411881513987",
    };
    expect(await deliverPendingTwoStepDm(ctx, plus, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    // 19:30:02 — «Купить»: имя уже настоящее; второе не повторяется.
    const buy = { ...plus, username: "dolphin.2023841" };
    expect(await deliverPendingTwoStepDm(ctx, buy, api)).toBe(false);
    expect(await deliverTwoStepFromDm(ctx, buy, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("id автора комментария не совпал с id отправителя — «+» по переписке, строка вебхука на «Купить» не шлёт", async () => {
    const { ctx, db, api, inbox, first } = twoRules();
    first();
    await commentWebhook(ctx, api, "c-30", {
      username: "dolphin.2023841",
      id: "17841400000000000",
    });
    const plus = {
      accountId: "acc-1",
      conversationId: "conv-30",
      username: "1407411881513987",
      senderId: "1407411881513987",
    };
    // «+»: строку вебхука не узнали — второе по первому сообщению в переписке.
    expect(await deliverPendingTwoStepDm(ctx, plus, api)).toBe(false);
    expect(await deliverTwoStepFromDm(ctx, plus, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    // «Купить» с настоящим именем находит строку вебхука — переписка уже получила второе.
    const buy = { ...plus, username: "dolphin.2023841" };
    expect(await deliverPendingTwoStepDm(ctx, buy, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(secondSteps(db).every((l) => l.status === "processed")).toBe(true);
  });

  it("вебхук успел и покупатель известен — прямая отправка; «+» и «Купить» потом ничего не повторяют", async () => {
    const { ctx, db, api, inbox, first } = twoRules();
    db.tables.bot_users = [
      { bot_id: BOT, platform: "instagram", username: "fro5654", zernio_conversation_id: "conv-7" },
    ];
    first();
    await commentWebhook(ctx, api, "c-34");
    expect(inbox).toHaveBeenCalledTimes(1);
    // Ещё раз по тому же покупателю (крон догнал, другое правило) — не шлёт.
    await commentWebhook(ctx, api, "c-35");
    expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(false);
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("второе не ушло — право отпускается, следующее сообщение покупателя пробует снова", async () => {
    const { ctx, api, inbox, first } = twoRules();
    first();
    inbox.mockResolvedValueOnce({ ok: false, error: "rate limit" } as never);
    expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(false);
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(2);
  });
});

describe("Comment-to-DM: кодовое слово прямо в Direct (Копилка русоведа, 09.10)", () => {
  const who = { accountId: "acc-1", conversationId: "conv-1", username: "lina" };
  function kwSetup(rules: Array<Record<string, unknown>>) {
    const { ctx, db } = setup();
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = {
      list: async () => rules,
      inbox,
      tail: vi.fn(async () => []),
    } as unknown as AutomationApi;
    return { ctx, db, api, inbox };
  }
  const palette = {
    id: "rule1",
    name: "Палитра",
    accountId: "acc-1",
    keywords: ["Палитра"],
    dmMessage: "Палитра — 1700 ₸",
  };

  it("«Палитра» в Direct — сообщение правила с кнопками уходит сразу, без «+»", async () => {
    const { ctx, db, api, inbox } = kwSetup([palette]);
    expect(await deliverTwoStepForDmKeyword(ctx, who, "палитра", api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      "Держите материалы",
      expect.objectContaining({ buttons: expect.any(Array) }),
    );
    expect(secondSteps(db).map((l) => l.status)).toEqual(["processed"]);
  });

  it("два «Палитра» подряд одновременно — сообщение одно", async () => {
    const { ctx, api, inbox } = kwSetup([palette]);
    await Promise.all([
      deliverTwoStepForDmKeyword(ctx, who, "Палитра", api),
      deliverTwoStepForDmKeyword(ctx, who, "Палитра", api),
    ]);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("длинный рассказ со словом, правило без слов, чужой аккаунт — не срабатывает", async () => {
    const long = kwSetup([palette]);
    expect(
      await deliverTwoStepForDmKeyword(
        long.ctx,
        who,
        "Палитру купила вчера, а файл так и не пришёл, проверьте пожалуйста",
        long.api,
      ),
    ).toBe(false);
    const any = kwSetup([{ ...palette, keywords: [] }]);
    expect(await deliverTwoStepForDmKeyword(any.ctx, who, "Здравствуйте", any.api)).toBe(false);
    const other = kwSetup([{ ...palette, accountId: "acc-2" }]);
    expect(await deliverTwoStepForDmKeyword(other.ctx, who, "Палитра", other.api)).toBe(false);
    expect(long.inbox).not.toHaveBeenCalled();
    expect(any.inbox).not.toHaveBeenCalled();
    expect(other.inbox).not.toHaveBeenCalled();
  });

  it("правило ответа на историю со словом — тоже срабатывает (обращение #50 Копилки)", async () => {
    const { ctx, api, inbox } = kwSetup([{ ...palette, trigger: "story_reply" }]);
    expect(await deliverTwoStepForDmKeyword(ctx, who, "Палитра", api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("правило без кодовых слов узнаётся по подписи поста, и «Политра» тоже (Копилка, 09.10)", async () => {
    const reel = {
      ...palette,
      id: "reel",
      name: "Рилс 09.10",
      keywords: [],
      postTitle: "Палитра для уроков русского языка",
      dmMessage: "Спасибо за интерес!",
      buttons: [{ type: "postback", title: "Купить", payload: "buy" }],
    };
    const other = { ...palette, id: "want", name: "Хочу", keywords: ["хочу"] };
    for (const word of ["Палитра", "политра", "Палитра!"]) {
      const { ctx, api, inbox, db } = kwSetup([other, reel]);
      expect(await deliverTwoStepForDmKeyword(ctx, who, word, api)).toBe(true);
      expect(inbox).toHaveBeenCalledTimes(1);
      expect(secondSteps(db)[0]?.payload).toMatchObject({ automationId: "reel" });
    }
    for (const word of ["Здравствуйте", "Хочу", "уроков нет?", "Пала"]) {
      const { ctx, api, inbox } = kwSetup([{ ...reel, postTitle: "Палитра" }]);
      expect(await deliverTwoStepForDmKeyword(ctx, who, word, api)).toBe(false);
      expect(inbox).not.toHaveBeenCalled();
    }
  });

  it("правило без поля keywords не роняет разбор, промах оставляет след с правилами", async () => {
    const { ctx, db, api, inbox } = kwSetup([{ ...palette, keywords: undefined }, palette]);
    expect(await deliverTwoStepForDmKeyword(ctx, who, "Здравствуйте", api)).toBe(false);
    expect(inbox).not.toHaveBeenCalled();
    const miss = db.tables.zernio_logs!.find((l) => l.event_type === "dm_keyword_miss");
    expect(miss?.payload).toMatchObject({
      text: "Здравствуйте",
      rules: [{ id: "rule1" }, { id: "rule1" }],
    });
  });
});
