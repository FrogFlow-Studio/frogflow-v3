import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { DEFAULT_REPLY_PROMPT, LEGACY_REPLY_PROMPTS } from "@/core/instagram/comment-rules";
import {
  RULE_GONE,
  SUPERSEDED,
  TWO_STEP_CLAIM_STALE_MS,
  TWO_STEP_MAX_ATTEMPTS,
  deliverPendingTwoStepDm,
  deliverTwoStepFromDm,
  deliverTwoStepForDmKeyword,
  expressAllowed,
  mentionsOwnedProduct,
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
      repeatPolicySetAt: "ok",
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

describe("Comment-to-DM: прежний призыв по умолчанию меняется на новый при чтении (Копилка, 09.10)", () => {
  const OLD = LEGACY_REPLY_PROMPTS[0];
  const oldFirst = `Палитра — таблички для кабинета\n\n${OLD}`;

  function promptSetup(servedBy: "v1" | "v2", dmMessage = oldFirst) {
    const { ctx, db } = setup();
    (ctx.tenant.settings as Record<string, unknown>).served_by = servedBy;
    db.tables.app_settings = [
      {
        bot_id: BOT,
        key: "ig_comment_automations_meta",
        value: JSON.stringify({
          rule1: {
            twoStepDm: true,
            secondDmMessage: "Держите материалы",
            secondDmButtons: [{ type: "postback", title: "Купить", payload: "PROD:p-1" }],
            replyPrompt: OLD,
          },
        }),
      },
    ];
    const rules = [
      {
        id: "rule1",
        name: "Палитра",
        accountId: "acc-1",
        keywords: [],
        dmMessage,
        repeatPolicy: { mode: "every_comment", cooldownHours: 24 },
      },
    ];
    const update = vi.fn(async (id: string, body: Record<string, unknown>) => {
      const r = rules.find((x) => x.id === id)!;
      if (typeof body.dmMessage === "string") r.dmMessage = body.dmMessage;
      return r;
    });
    const inbox = vi.fn(async () => ({ ok: true }));
    const tail = vi.fn(async (): Promise<Array<Record<string, unknown>>> => []);
    const api = {
      list: async () => rules.map((r) => ({ ...r })),
      update,
      inbox,
      tail,
    } as unknown as AutomationApi;
    return { ctx, db, api, update, inbox, tail, rules };
  }

  it("текст продавца остаётся, хвост — новый призыв; мета и журнал с временем замены; повторно Zernio не трогаем", async () => {
    const { listAutomations, getAutomationsMeta } = await import("./automations.server");
    const { ctx, db, api, update, rules } = promptSetup("v2");
    const listed = await listAutomations(ctx, api);
    const next = `Палитра — таблички для кабинета\n\n${DEFAULT_REPLY_PROMPT}`;
    expect(update).toHaveBeenCalledWith("rule1", { dmMessage: next });
    expect(rules[0]!.dmMessage).toBe(next);
    expect((await getAutomationsMeta(ctx)).rule1).toMatchObject({
      twoStepDm: true,
      replyPrompt: DEFAULT_REPLY_PROMPT,
      secondDmButtons: [{ type: "postback", title: "Купить", payload: "PROD:p-1" }],
    });
    // В форме — текст продавца без призыва, первое сообщение целиком — с новым.
    expect(listed[0]).toMatchObject({
      dmMessage: "Палитра — таблички для кабинета",
      firstMessage: next,
      replyPrompt: DEFAULT_REPLY_PROMPT,
    });
    const log = db.tables.zernio_logs!.filter(
      (l) => l.event_type === "comment_rule.prompt_upgraded",
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      event_id: "prompt-upgrade:rule1",
      payload: { automationId: "rule1", from: OLD, to: DEFAULT_REPLY_PROMPT, textChanged: true },
    });

    update.mockClear();
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();
  });

  it("два чтения одновременно — у Zernio один и тот же текст, строка журнала одна", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, db, api, rules } = promptSetup("v2");
    await Promise.all([listAutomations(ctx, api), listAutomations(ctx, api)]);
    expect(rules[0]!.dmMessage).toBe(`Палитра — таблички для кабинета\n\n${DEFAULT_REPLY_PROMPT}`);
    expect(
      db.tables.zernio_logs!.filter((l) => l.event_type === "comment_rule.prompt_upgraded"),
    ).toHaveLength(1);
  });

  it("«+» на первое сообщение, ушедшее до замены, — второе сообщение с кнопкой уходит", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, db, api, inbox, tail } = promptSetup("v2");
    await listAutomations(ctx, api);
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    tail.mockResolvedValue([
      { id: "m-1", direction: "outgoing", message: oldFirst, createdAt: at(20_000) },
      { id: "m-2", direction: "incoming", message: "+", createdAt: at(1_000) },
    ]);
    const who = { accountId: "acc-1", conversationId: "conv-1", username: "Anya" };
    expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      "Держите материалы",
      expect.objectContaining({
        buttons: [{ type: "postback", title: "Купить", payload: "PROD:p-1" }],
      }),
    );
    expect(secondSteps(db).map((l) => [l.event_id, l.status])).toEqual([
      ["two-step-dm:dm:m-1", "processed"],
    ]);
  });

  it("«любое слово» в ответ на новое первое сообщение тоже отдаёт второе", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, api, inbox, tail, rules } = promptSetup("v2");
    await listAutomations(ctx, api);
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    tail.mockResolvedValue([
      { id: "m-1", direction: "outgoing", message: rules[0]!.dmMessage, createdAt: at(20_000) },
      { id: "m-2", direction: "incoming", message: "Как получить?", createdAt: at(1_000) },
    ]);
    const who = { accountId: "acc-1", conversationId: "conv-1", username: "Anya" };
    expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("«+» на чужое сообщение с тем же призывом — «Палитру» не шлём (Копилка, 12.10, заказ #144)", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, db, api, inbox, tail } = promptSetup("v2");
    await listAutomations(ctx, api);
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    // gritsevichnadezhda: «Зори» под бесплатным постом с пазлами (правила «Палитра» там нет),
    // материал пришёл с тем же призывом в конце; потом «+».
    for (const prompt of [DEFAULT_REPLY_PROMPT, OLD]) {
      tail.mockResolvedValue([
        {
          id: "m-zori",
          direction: "outgoing",
          message: `Пазлы «Зори» — забирайте бесплатно!\n\n${prompt}`,
          createdAt: at(13 * 60_000),
        },
        { id: "m-plus", direction: "incoming", message: "+", createdAt: at(1_000) },
      ]);
      const who = { accountId: "acc-1", conversationId: "conv-1", username: "gritsevichnadezhda" };
      expect(await deliverTwoStepFromDm(ctx, who, api)).toBe(false);
    }
    expect(inbox).not.toHaveBeenCalled();
    expect(secondSteps(db)).toEqual([]);
  });

  it("«+» на чужое сообщение с призывом — один вопрос о товаре, след в журнале; на первое сообщение правила — нет", async () => {
    const { listAutomations, plusAnswersUnknownPrompt } = await import("./automations.server");
    const { ctx, db, api, tail, rules } = promptSetup("v2");
    await listAutomations(ctx, api);
    const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    const who = { accountId: "acc-1", conversationId: "conv-1", username: "gritsevichnadezhda" };
    tail.mockResolvedValue([
      {
        id: "m-zori",
        direction: "outgoing",
        message: `Пазлы «Зори» — забирайте!\n\n${DEFAULT_REPLY_PROMPT}`,
        createdAt: at(13 * 60_000),
      },
    ]);
    // Два «+» одновременно (повтор вебхука, двойная отправка) — спрашивает один.
    const both = await Promise.all([
      plusAnswersUnknownPrompt(ctx, who, api),
      plusAnswersUnknownPrompt(ctx, who, api),
    ]);
    expect(both.sort()).toEqual(["ask", "asked"]);
    // Ещё «+» на то же сообщение — вопрос не повторяем.
    expect(await plusAnswersUnknownPrompt(ctx, who, api)).toBe("asked");
    const trail = db.tables.zernio_logs!.filter((l) => l.event_type === "two_step_dm_unmatched");
    expect(trail).toHaveLength(1);
    expect(String((trail[0]!.payload as { answered: string }).answered)).toContain("Зори");
    // Обычное сообщение продавца без призыва — не наш случай, «+» идёт дальше как раньше.
    tail.mockResolvedValue([
      { id: "m-2", direction: "outgoing", message: "Здравствуйте!", createdAt: at(60_000) },
    ]);
    expect(await plusAnswersUnknownPrompt(ctx, who, api)).toBeNull();
    // Давнее сообщение с призывом — тоже не наш случай.
    tail.mockResolvedValue([
      { id: "m-3", direction: "outgoing", message: rules[0]!.dmMessage, createdAt: at(3600_000) },
    ]);
    expect(await plusAnswersUnknownPrompt(ctx, who, api)).toBeNull();
  });

  it("продавец сам убрал призыв из текста — правило не трогаем", async () => {
    const { listAutomations, getAutomationsMeta } = await import("./automations.server");
    const { ctx, api, update } = promptSetup("v2", "Свой текст без призыва");
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();
    expect((await getAutomationsMeta(ctx)).rule1).toMatchObject({ replyPrompt: OLD });
  });

  it("клиент ещё на v1 — правило не трогаем", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, api, update } = promptSetup("v1");
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Comment-to-DM: «ничего нет» под постом — подсказка про «Запросы» (Копилка, _nonna2015_)", () => {
  function hintSetup(servedBy: "v1" | "v2" = "v2") {
    const { ctx, db, api } = setup();
    (ctx.tenant.settings as Record<string, unknown>).served_by = servedBy;
    db.tables.bot_users = [];
    const publicReply = vi.fn(async () => ({ ok: true }));
    (api as unknown as Record<string, unknown>).publicReply = publicReply;
    (api as unknown as Record<string, unknown>).update = vi.fn(async () => ({}));
    const comment = (id: string, text: string, username = "nonna2015") => ({
      account: { id: "acc-1" },
      comment: { id, text, platformPostId: "ig-post-1", author: { id: "u-9", username } },
    });
    return { ctx, db, api, publicReply, comment };
  }
  /** created_at в базе ставит default; в fakeDb у вставки его нет — проставляем. */
  const first = async (
    h: ReturnType<typeof hintSetup>,
    id = "c-1",
    at = new Date().toISOString(),
  ) => {
    await handleCommentReceived(h.ctx, h.comment(id, "хочу"), h.api, { delayMs: 0 });
    for (const l of h.db.tables.zernio_logs!) l.created_at ??= at;
  };
  const hints = (db: ReturnType<typeof fakeDb>) =>
    db.tables.zernio_logs!.filter((l) => l.event_type === "comment.requests_hint");

  it("первое уже ушло — публичный ответ под комментарием, второе по нему не ставим", async () => {
    const h = hintSetup();
    const { ctx, db, api, publicReply, comment } = h;
    await first(h);
    expect(secondSteps(db).map((l) => l.status)).toEqual(["pending"]);
    const r = await handleCommentReceived(ctx, comment("c-2", "Ничего нет"), api, { delayMs: 0 });
    expect(r.note).toBe("подсказка про «Запросы» @nonna2015");
    expect(publicReply).toHaveBeenCalledTimes(1);
    expect(publicReply).toHaveBeenCalledWith(
      "ig-post-1",
      "c-2",
      "acc-1",
      expect.stringContaining("«Запросы»"),
    );
    expect(hints(db).map((l) => [l.event_id, l.status])).toEqual([
      ["requests-hint:c-2", "processed"],
    ]);
    expect(secondSteps(db).map((l) => l.event_id)).toEqual(["two-step-dm:c-1"]);
  });

  it("повтор вебхука и два одновременно — ответ один", async () => {
    const h = hintSetup();
    const { ctx, api, publicReply, comment } = h;
    await first(h);
    const [a, b] = await Promise.all([
      handleCommentReceived(ctx, comment("c-2", "не пришло"), api, { delayMs: 0 }),
      handleCommentReceived(ctx, comment("c-2", "не пришло"), api, { delayMs: 0 }),
    ]);
    await handleCommentReceived(ctx, comment("c-2", "не пришло"), api, { delayMs: 0 });
    expect(publicReply).toHaveBeenCalledTimes(1);
    expect([a.note, b.note].sort()).toEqual([
      "подсказка про «Запросы» @nonna2015",
      "подсказка про «Запросы» уже ушла",
    ]);
  });

  it("язык подсказки — по комментарию", async () => {
    const h = hintSetup();
    const { ctx, api, publicReply, comment } = h;
    await first(h);
    await handleCommentReceived(ctx, comment("c-2", "ештеңе жоқ"), api, { delayMs: 0 });
    expect(publicReply).toHaveBeenCalledWith(
      "ig-post-1",
      "c-2",
      "acc-1",
      expect.stringContaining("«Сұраулар»"),
    );
  });

  it("первого сообщения не было — «ничего нет» идёт обычным путём, без подсказки", async () => {
    const { ctx, db, api, publicReply, comment } = hintSetup();
    await handleCommentReceived(ctx, comment("c-3", "ничего нет"), api, { delayMs: 0 });
    expect(publicReply).not.toHaveBeenCalled();
    expect(hints(db)).toEqual([]);
  });

  it("первое было больше суток назад — без подсказки", async () => {
    const h = hintSetup();
    const { ctx, api, publicReply, comment } = h;
    await first(h, "c-1", new Date(Date.now() - 25 * 60 * 60_000).toISOString());
    await handleCommentReceived(ctx, comment("c-2", "ничего нет"), api, { delayMs: 0 });
    expect(publicReply).not.toHaveBeenCalled();
  });

  it("Instagram отказал — отметка «failed», повторно не шлём", async () => {
    const h = hintSetup();
    const { ctx, db, api, publicReply, comment } = h;
    publicReply.mockResolvedValue({ ok: false, error: "timeout" } as never);
    await first(h);
    const r = await handleCommentReceived(ctx, comment("c-2", "ничего нет"), api, { delayMs: 0 });
    expect(r.note).toBe("подсказка про «Запросы» не ушла @nonna2015");
    await handleCommentReceived(ctx, comment("c-2", "ничего нет"), api, { delayMs: 0 });
    expect(publicReply).toHaveBeenCalledTimes(1);
    expect(hints(db).map((l) => [l.status, l.error_message])).toEqual([["failed", "timeout"]]);
  });

  it("клиент ещё на v1 — не отвечаем", async () => {
    const h = hintSetup("v1");
    const { ctx, api, publicReply, comment } = h;
    await first(h);
    await handleCommentReceived(ctx, comment("c-2", "ничего нет"), api, { delayMs: 0 });
    expect(publicReply).not.toHaveBeenCalled();
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

describe("Comment-to-DM: одно сообщение на человека за сутки (Копилка 11.10, vertsanova.svetlana)", () => {
  function dupSetup() {
    const { ctx, db, api, inbox } = setup();
    db.tables.bot_users = [];
    const comment = (id: string, text: string, username = "vertsanova.svetlana") => ({
      account: { id: "acc-1" },
      comment: { id, text, platformPostId: "ig-post-1", author: { id: "u-7", username } },
    });
    /** created_at в базе ставит default; в fakeDb у вставки его нет — проставляем. */
    const stamp = (at = new Date().toISOString()) => {
      for (const l of db.tables.zernio_logs!) l.created_at ??= at;
    };
    return { ctx, db, api, inbox, comment, stamp };
  }

  it("два комментария подряд под одним постом — одно второе сообщение в очереди", async () => {
    const { ctx, db, api, comment, stamp } = dupSetup();
    const a = await handleCommentReceived(ctx, comment("c-1", "Хочу. Благодарю."), api, {
      delayMs: 0,
    });
    stamp();
    const b = await handleCommentReceived(ctx, comment("c-2", "Хочу! Жду. Очень надо"), api, {
      delayMs: 0,
    });
    expect(a.note).toBe("в очередь pending @vertsanova.svetlana");
    expect(b.note).toBe("повторный комментарий @vertsanova.svetlana — сообщение уже было");
    expect(secondSteps(db).map((l) => l.event_id)).toEqual(["two-step-dm:c-1"]);
  });

  it("имя с «_» и в другом регистре — тот же человек", async () => {
    const { ctx, db, api, comment, stamp } = dupSetup();
    await handleCommentReceived(ctx, comment("c-1", "хочу", "Anna_K"), api, { delayMs: 0 });
    stamp();
    await handleCommentReceived(ctx, comment("c-2", "хочу", "anna_k"), api, { delayMs: 0 });
    await handleCommentReceived(ctx, comment("c-3", "хочу", "annaxk"), api, { delayMs: 0 });
    expect(secondSteps(db).map((l) => l.event_id)).toEqual(["two-step-dm:c-1", "two-step-dm:c-3"]);
  });

  it("прошлый комментарий больше суток назад — сообщение снова", async () => {
    const { ctx, db, api, comment, stamp } = dupSetup();
    await handleCommentReceived(ctx, comment("c-1", "хочу"), api, { delayMs: 0 });
    stamp(new Date(Date.now() - 25 * 60 * 60_000).toISOString());
    await handleCommentReceived(ctx, comment("c-2", "хочу"), api, { delayMs: 0 });
    expect(secondSteps(db).map((l) => l.event_id)).toEqual(["two-step-dm:c-1", "two-step-dm:c-2"]);
  });

  it("журнал не прочитан — ошибка наружу, а не второе сообщение вслепую", async () => {
    const { ctx, db, api, comment, stamp } = dupSetup();
    await handleCommentReceived(ctx, comment("c-1", "хочу"), api, { delayMs: 0 });
    stamp();
    const from = db.from.bind(db);
    let reads = 0;
    (db as unknown as { from: unknown }).from = (t: string) => {
      const q = from(t);
      if (t !== "zernio_logs") return q;
      // Второе чтение журнала по этому комментарию — проверка «уже было».
      const ilike = q.ilike?.bind(q);
      if (ilike)
        (q as unknown as { ilike: unknown }).ilike = (...args: unknown[]) => {
          reads++;
          return Object.assign(ilike(...(args as [string, string])), {
            then: (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: { message: "timeout" } }).then(res),
          });
        };
      return q;
    };
    await expect(
      handleCommentReceived(ctx, comment("c-2", "хочу"), api, { delayMs: 0 }),
    ).rejects.toThrow();
    expect(reads).toBeGreaterThan(0);
    expect(secondSteps(db).map((l) => l.event_id)).toEqual(["two-step-dm:c-1"]);
  });
});

describe("Comment-to-DM: повтор первого сообщения у Zernio — не чаще раза в сутки", () => {
  function policySetup(servedBy: "v1" | "v2", repeatPolicy?: Record<string, unknown>) {
    const { ctx, db } = setup();
    (ctx.tenant.settings as Record<string, unknown>).served_by = servedBy;
    const rules = [
      {
        id: "rule1",
        name: "Палитра",
        accountId: "acc-1",
        keywords: [],
        dmMessage: "Привет",
        ...(repeatPolicy ? { repeatPolicy } : {}),
      },
    ];
    const update = vi.fn(async (id: string, body: Record<string, unknown>) => ({ id, ...body }));
    const api = { list: async () => rules, update } as unknown as AutomationApi;
    return { ctx, db, api, update };
  }

  it("правило без ограничения получает every_comment + 24 ч один раз, отметка в мете и журнале", async () => {
    const { listAutomations, getAutomationsMeta } = await import("./automations.server");
    const { ctx, db, api, update } = policySetup("v2");
    await listAutomations(ctx, api);
    await listAutomations(ctx, api);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("rule1", {
      repeatPolicy: { mode: "every_comment", cooldownHours: 24 },
    });
    expect((await getAutomationsMeta(ctx)).rule1).toMatchObject({
      twoStepDm: true,
      repeatPolicySetAt: "ok",
    });
    expect(
      db.tables.zernio_logs!.filter((l) => l.event_type === "comment_rule.repeat_policy"),
    ).toHaveLength(1);
  });

  it("every_comment без паузы — тоже приводим", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, api, update } = policySetup("v2", { mode: "every_comment" });
    await listAutomations(ctx, api);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("once (строже) и уже сутки — не трогаем", async () => {
    const { listAutomations } = await import("./automations.server");
    for (const p of [{ mode: "once" }, { mode: "every_comment", cooldownHours: 48 }]) {
      const { ctx, api, update } = policySetup("v2", p);
      await listAutomations(ctx, api);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("Zernio отказал — на следующем чтении не повторяем, правило работает как было", async () => {
    const { listAutomations, getAutomationsMeta } = await import("./automations.server");
    const { ctx, api, update } = policySetup("v2");
    update.mockRejectedValueOnce(new Error("400 repeatPolicy"));
    const listed = await listAutomations(ctx, api);
    expect(listed).toHaveLength(1);
    await listAutomations(ctx, api);
    expect(update).toHaveBeenCalledTimes(1);
    expect((await getAutomationsMeta(ctx)).rule1?.repeatPolicySetAt).not.toBe("ok");
  });

  it("клиент ещё на v1 — правило не трогаем", async () => {
    const { listAutomations } = await import("./automations.server");
    const { ctx, api, update } = policySetup("v1");
    await listAutomations(ctx, api);
    expect(update).not.toHaveBeenCalled();
  });

  it("сохранение правила отдаёт Zernio повтор раз в сутки", async () => {
    const { saveAutomation } = await import("./automations.server");
    const { ctx, api, update } = policySetup("v2");
    await saveAutomation(
      ctx,
      {
        id: "rule1",
        original: { platformPostId: null, postId: null, trigger: "comment" },
        accountId: "acc-1",
        profileId: "p-1",
        name: "Хочу",
        keywords: ["хочу"],
        dmMessage: "Держите",
      },
      api,
    );
    expect(update).toHaveBeenCalledWith(
      "rule1",
      expect.objectContaining({ repeatPolicy: { mode: "every_comment", cooldownHours: 24 } }),
    );
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

describe("Comment-to-DM: быстрая покупка только на кодовое слово (Копилка, 09.10, заказ #45)", () => {
  function anyCommentRule() {
    const { ctx, db } = setup();
    db.tables.bot_users = [];
    db.tables.products = [{ id: "p-1", bot_id: BOT, name: "Палитра средств выразительности" }];
    db.tables.app_settings = [
      {
        bot_id: BOT,
        key: "ig_comment_automations_meta",
        value: JSON.stringify({
          reel: {
            twoStepDm: true,
            secondDmButtons: [{ type: "postback", title: "Купить", payload: "PROD:p-1" }],
          },
        }),
      },
    ];
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = {
      // Правило рилса без кодовых слов: Zernio отвечает на любой комментарий.
      list: async () => [
        { id: "reel", name: "Рилс", accountId: "acc-1", keywords: [], dmMessage: "Привет!" },
      ],
      inbox,
      tail: vi.fn(async () => []),
    } as unknown as AutomationApi;
    const comment = async (text: string) => {
      await handleCommentReceived(ctx, event(text), api, { delayMs: 0 });
      for (const l of db.tables.zernio_logs!) l.created_at ??= new Date().toISOString();
    };
    return { ctx, api, inbox, comment };
  }
  const event = (text: string) => ({
    account: { id: "acc-1" },
    post: { platformPostId: "ig-reel-1", content: "Пишите слово «Палитра»" },
    comment: { id: `c-${text}`, text, author: { id: "u-1", username: "dinara" } },
  });
  const who = (express: (id: string) => Promise<boolean>) => ({
    accountId: "acc-1",
    conversationId: "conv-1",
    username: "dinara",
    express,
  });

  it("«Уголок» под рилсом с «Палитрой» — не заказ на «Палитру», а обычное второе сообщение с «Купить»", async () => {
    const { ctx, api, inbox, comment } = anyCommentRule();
    await comment("Уголок");
    const express = vi.fn(async () => true);
    expect(await deliverPendingTwoStepDm(ctx, who(express), api)).toBe(true);
    expect(express).not.toHaveBeenCalled();
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("«Палитра» (и «Политра») — сразу заказ на товар", async () => {
    for (const word of ["Палитра", "политра"]) {
      const { ctx, api, inbox, comment } = anyCommentRule();
      await comment(word);
      const express = vi.fn(async () => true);
      expect(await deliverPendingTwoStepDm(ctx, who(express), api)).toBe(true);
      expect(express).toHaveBeenCalledWith("p-1");
      expect(inbox).not.toHaveBeenCalled();
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
    // Второе ушло на «+» по этому же правилу — комментарий второго не ставит.
    expect(r.note).toBe("повторный комментарий @anya — сообщение уже было");
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
    // Строку вебхука закрыла ушедшая новая: работает последняя.
    expect(secondSteps(db).map((l) => l.status)).toEqual(["skipped", "processed"]);
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

  it("правило без кодовых слов узнаётся по слову в кавычках из подписи, и «Политра» тоже (Копилка, 09.10)", async () => {
    const reel = {
      ...palette,
      id: "reel",
      name: "Рилс 09.10",
      keywords: [],
      postTitle: 'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию',
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
    for (const word of ["Здравствуйте", "Хочу", "комментариях", "информацию", "Пала"]) {
      const { ctx, api, inbox } = kwSetup([reel]);
      expect(await deliverTwoStepForDmKeyword(ctx, who, word, api)).toBe(false);
      expect(inbox).not.toHaveBeenCalled();
    }
  });

  it("правило без кодовых слов: в Direct только название правила или товара, не слова его текстов (Копилка, заказ #127)", async () => {
    const rule = {
      id: "pal127",
      name: "Палитра",
      accountId: "acc-1",
      keywords: [],
      twoStepDm: true,
      postTitle:
        'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию. Стоимость материала в электронном формате 1700 тг.',
      dmMessage: "Материал для оформления кабинета и к праздникам",
      secondDmMessage: "Палитра средств выразительности — к оформлению и праздникам",
      buttons: [{ type: "postback", title: "Купить", payload: "PROD:p-pal" }],
    };
    for (const word of ["Оформление и праздники", "оформление", "праздники", "электронном"]) {
      const { ctx, api, inbox } = kwSetup([rule]);
      expect(await deliverTwoStepForDmKeyword(ctx, who, word, api)).toBe(false);
      expect(inbox).not.toHaveBeenCalled();
    }
    for (const word of ["Палитра", "Палитра средств выразительности", "Хочу палитру"]) {
      const { ctx, db, api, inbox } = kwSetup([rule]);
      db.tables.products = [{ id: "p-pal", bot_id: BOT, name: "Палитра средств выразительности" }];
      expect(await deliverTwoStepForDmKeyword(ctx, who, word, api)).toBe(true);
      expect(inbox).toHaveBeenCalledTimes(1);
    }
  });

  it("часть длинного названия или рассказ о покупке — не правило (Копилка, заказ #146)", async () => {
    const rule = {
      id: "pal146",
      name: "Палитра",
      accountId: "acc-1",
      keywords: [],
      twoStepDm: true,
      dmMessage: "Материал для оформления кабинета",
      buttons: [{ type: "postback", title: "Купить", payload: "PROD:p-pal" }],
    };
    for (const word of [
      "Выразит.средства я у вас покупала",
      "средства выразительности",
      "средства",
      "Палитра у меня уже есть",
      "Палитру оплатила вчера",
      "Палитра не открывается",
    ]) {
      const { ctx, db, api, inbox } = kwSetup([rule]);
      db.tables.products = [{ id: "p-pal", bot_id: BOT, name: "Палитра средств выразительности" }];
      expect(await deliverTwoStepForDmKeyword(ctx, who, word, api), word).toBe(false);
      expect(inbox).not.toHaveBeenCalled();
    }
    // Кодовое слово продавца тоже не продаёт тому, кто пишет о купленном.
    const kw = kwSetup([palette]);
    expect(await deliverTwoStepForDmKeyword(kw.ctx, who, "Палитра уже куплена", kw.api)).toBe(
      false,
    );
    expect(kw.inbox).not.toHaveBeenCalled();
  });

  it("рассказ о купленном и просьбы различаются", () => {
    for (const t of [
      "я у вас покупала",
      "Купила палитру",
      "уже оплатила",
      "у меня есть",
      "Приобрела",
    ])
      expect(mentionsOwnedProduct(t), t).toBe(true);
    for (const t of ["Купить", "Палитра", "пришлите палитру", "Хочу купить", "Покупка"])
      expect(mentionsOwnedProduct(t), t).toBe(false);
    const rule = { name: "Палитра", keywords: ["палитра"], dmMessage: "Палитра — 1700 ₸" };
    expect(expressAllowed("Палитра", rule)).toBe(true);
    expect(expressAllowed("Палитра у меня уже есть", rule)).toBe(false);
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

describe("Comment-to-DM: правило с подписью поста — только под своим постом (Копилка #96, AATeach #1361)", () => {
  const PALITRA =
    'Пишите в комментариях слово "Палитра" и я вышлю подробную информацию. Стоимость материала в электронном формате 1700 тг.';
  const BREAD =
    "🍞Пишите слово ХЛЕБ в комментариях и я отправлю вам в личные сообщения всю информацию по получению комплекта 😉";
  const PAMYATKI =
    "📐Пишите слово НУЖНО в комментариях под этим видео и я отправлю вам в личные сообщения всю информацию по получению памяток";

  function ownPostSetup(rule: { keywords: string[]; postTitle: string; name: string }) {
    const { ctx, db, inbox } = setup();
    const api = {
      list: async () => [{ id: "rule1", accountId: "acc-1", dmMessage: "Ответьте «+»", ...rule }],
      inbox,
    } as unknown as AutomationApi;
    const comment = (id: string, text: string, content?: string) => ({
      account: { id: "acc-1" },
      post: { platformPostId: `post-${id}`, ...(content === undefined ? {} : { content }) },
      comment: {
        id,
        text,
        platformPostId: `post-${id}`,
        author: { id: `u-${id}`, username: "anya" },
      },
    });
    return { ctx, db, api, inbox, comment };
  }

  it("«Палитра» без слов: «Уголок» под рилсом про уголок — не срабатывает, под своим рилсом «Хочу» — срабатывает", async () => {
    const h = ownPostSetup({ name: "Палитра", keywords: [], postTitle: PALITRA });
    const foreign = await handleCommentReceived(
      h.ctx,
      h.comment(
        "c-1",
        "Уголок",
        'Пишите в комментариях слово "уголок" и материал придёт в личные сообщения 🤎',
      ),
      h.api,
      { delayMs: 0 },
    );
    expect(foreign.note).toBe("правило не совпало");
    expect(secondSteps(h.db)).toEqual([]);

    const own = await handleCommentReceived(h.ctx, h.comment("c-2", "Хочу", PALITRA), h.api, {
      delayMs: 0,
    });
    expect(own.note).toBe("второе сообщение @anya");
    expect(secondSteps(h.db).map((l) => l.event_id)).toEqual(["two-step-dm:c-2"]);
    expect(h.inbox).toHaveBeenCalledTimes(1);
  });

  it("подписи поста в событии нет — срабатывает, только если комментарий называет товар («Политра»), «Викторина» — нет", async () => {
    const h = ownPostSetup({ name: "Палитра", keywords: [], postTitle: PALITRA });
    expect(
      (await handleCommentReceived(h.ctx, h.comment("c-1", "Викторина"), h.api, { delayMs: 0 }))
        .note,
    ).toBe("правило не совпало");
    expect(
      (await handleCommentReceived(h.ctx, h.comment("c-2", "Политра"), h.api, { delayMs: 0 })).note,
    ).toBe("второе сообщение @anya");
    expect(secondSteps(h.db).map((l) => l.event_id)).toEqual(["two-step-dm:c-2"]);
  });

  it("«день хлеба» со словом «нужно»: «Нужно» под рилсом памяток — не срабатывает, под рилсом про хлеб — срабатывает", async () => {
    const h = ownPostSetup({ name: "день хлеба", keywords: ["хлеб", "нужно"], postTitle: BREAD });
    expect(
      (
        await handleCommentReceived(h.ctx, h.comment("c-1", "Нужно", PAMYATKI), h.api, {
          delayMs: 0,
        })
      ).note,
    ).toBe("правило не совпало");
    // Подпись в событии полная, у правила — та же, с другими пробелами и переносом.
    const caption = BREAD.replace("в личные", "в\nличные") + "\n\nВ комплекте 12 карточек";
    expect(
      (
        await handleCommentReceived(h.ctx, h.comment("c-2", "Нужно", caption), h.api, {
          delayMs: 0,
        })
      ).note,
    ).toBe("второе сообщение @anya");
    expect(secondSteps(h.db).map((l) => l.event_id)).toEqual(["two-step-dm:c-2"]);
  });
});

describe("Comment-to-DM: работает только последнее видео, ожидание сутки (AATeach 10.10–11.10)", () => {
  // Покупатель писал под двумя видео; в Direct диалога ещё не было — обе
  // «Купить» в очереди. Ответ — второе последнего видео, прежнее закрыто.
  const who = { accountId: "acc-1", conversationId: "conv-1", username: "anya" };
  const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const row = (id: string, rule: string, text: string, msAgo: number) => ({
    id,
    bot_id: BOT,
    event_id: `two-step-dm:${id}`,
    event_type: "two_step_dm_pending",
    status: "pending",
    error_message: null,
    created_at: at(msAgo),
    payload: { username: "anya", automationId: rule, secondText: text, buttons: [] },
  });
  function withRules(rules: string[]) {
    const { ctx, db } = setup();
    const inbox = vi.fn(async () => ({ ok: true }));
    const api = {
      list: async () =>
        rules.map((id) => ({
          id,
          name: id,
          accountId: "acc-1",
          keywords: ["нужно"],
          dmMessage: "x",
        })),
      inbox,
      tail: vi.fn(async () => []),
    } as unknown as AutomationApi;
    return { ctx, db, api, inbox };
  }
  const statusOf = (db: ReturnType<typeof fakeDb>, id: string) =>
    db.tables.zernio_logs!.find((l) => l.id === id) as { status: string; error_message: string };

  it("комментарии под двумя видео — уходит «Купить» последнего, прежнее не всплывает позже", async () => {
    const { ctx, db, api, inbox } = withRules(["padezhi", "hleb"]);
    db.tables.zernio_logs!.push(
      row("old", "padezhi", "Падежи: нажмите «Купить»", 3 * 3600_000),
      row("new", "hleb", "Хлеб: нажмите «Купить»", 3600_000),
    );
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(true);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      "Хлеб: нажмите «Купить»",
      expect.anything(),
    );
    expect(statusOf(db, "new").status).toBe("processed");
    expect(statusOf(db, "old")).toMatchObject({ status: "skipped", error_message: SUPERSEDED });
    // Через час покупатель пишет снова — второе прежнего видео не приходит.
    const later = () => new Date(Date.now() + 3600_000);
    expect(await deliverPendingTwoStepDm(ctx, who, api, later)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("ответ позже суток после комментария — «Купить» не присылаем", async () => {
    const { ctx, db, api, inbox } = withRules(["hleb"]);
    db.tables.zernio_logs!.push(row("stale", "hleb", "Хлеб", 25 * 3600_000));
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).not.toHaveBeenCalled();
  });

  it("правило удалено продавцом — его «Купить» из очереди не уходит", async () => {
    const { ctx, db, api, inbox } = withRules(["padezhi"]);
    db.tables.zernio_logs!.push(row("bread", "hleb", "Хлеб", 3600_000));
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).not.toHaveBeenCalled();
    expect(statusOf(db, "bread")).toMatchObject({ status: "skipped", error_message: RULE_GONE });
  });

  it("новый комментарий при живой переписке — второе уходит сразу, прежнее из очереди закрыто", async () => {
    const { ctx, db, api, inbox } = withRules(["padezhi", "hleb"]);
    db.tables.zernio_logs!.push(row("old", "padezhi", "Падежи", 3 * 3600_000));
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-new", text: "нужно", author: { id: "u-1", username: "anya" } },
      },
      {
        ...api,
        list: async () => [
          {
            id: "hleb",
            name: "hleb",
            accountId: "acc-1",
            keywords: ["нужно"],
            dmMessage: "x",
            buttons: [{ type: "postback", title: "Купить", payload: "PROD:p-1" }],
          },
        ],
      } as unknown as AutomationApi,
      { delayMs: 0 },
    );
    expect(r.note).toBe("второе сообщение @anya");
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(statusOf(db, "old")).toMatchObject({ status: "skipped", error_message: SUPERSEDED });
    // Повтор вебхука прежнего комментария строку не воскрешает.
    expect(await deliverPendingTwoStepDm(ctx, who, api)).toBe(false);
    expect(inbox).toHaveBeenCalledTimes(1);
  });

  it("два ответа одновременно — уходит одно второе сообщение", async () => {
    const { ctx, db, api, inbox } = withRules(["padezhi", "hleb"]);
    db.tables.zernio_logs!.push(
      row("old", "padezhi", "Падежи", 3 * 3600_000),
      row("new", "hleb", "Хлеб", 3600_000),
    );
    await Promise.all([
      deliverPendingTwoStepDm(ctx, who, api),
      deliverPendingTwoStepDm(ctx, who, api),
    ]);
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveBeenCalledWith("conv-1", "acc-1", "Хлеб", expect.anything());
  });
});
