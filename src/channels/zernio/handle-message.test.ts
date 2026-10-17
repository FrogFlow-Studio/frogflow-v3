import { describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";

const customer = {
  userKey: "wa:77001112233",
  platform: "whatsapp",
  telegramId: -7,
  firstName: "Аня",
  state: { consultant: { last_reply_at: new Date(Date.now() - 3600_000).toISOString() } },
} as unknown as Customer;

const setState = vi.fn(async (_ctx: unknown, c: Customer, state: Customer["state"]) => ({
  ...c,
  state,
}));
vi.mock("@/core/customers/customers", () => ({
  upsertCustomer: vi.fn(async () => customer),
  isBlocked: vi.fn(async () => false),
  setState,
}));
const notifyAdminsHtml = vi.fn(async (_ctx: unknown, _html: string, _o?: unknown) => 1);
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml }));
vi.mock("@/core/instagram/direct-bot-settings", () => ({
  loadDirectBotSettings: vi.fn(async () => ({ enabled: true, ignoreExcluded: false })),
}));
const pauseConsultant = vi.fn(async () => {});
const runConsultant = vi.fn(async () => ({ reply: "Здравствуйте!" }));
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => true,
  isPaused: () => false,
  pauseConsultant,
  runConsultant,
}));

/** «Связаться с продавцом»: метку забирает условная запись; здесь — чем она ответила. */
const claimContactRequest = vi.fn(async (_ctx: unknown, c: Customer) => c as Customer | null);
vi.mock("@/core/instagram/contact-request", () => ({ claimContactRequest }));
const createTicket = vi.fn(async () => ({ ticket: { number: 7 }, created: true }));
vi.mock("@/core/helpdesk/tickets", () => ({
  createTicket,
  ticketAwaitingRating: async () => null,
  rateTicket: async () => "invalid",
  clearRatingAsked: async () => {},
}));
vi.mock("@/core/chat/chat", () => ({
  inboundIntercepted: vi.fn(async () => false),
  recordMessage: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
}));

const setOptOut = vi.fn(async () => true);
vi.mock("@/core/customers/opt-out", async (orig) => ({
  ...(await orig<typeof import("@/core/customers/opt-out")>()),
  setOptOut,
}));

// Comment-to-DM: второе сообщение этому покупателю только что забрал другой вебхук.
const twoStepJustDelivered = vi.fn(async () => false);
const deliverPendingTwoStepDm = vi.fn(async () => false);
const deliverTwoStepFromDm = vi.fn(async () => false);
const deliverTwoStepForDmKeyword = vi.fn(async (..._a: unknown[]) => false);
const plusAnswersUnknownPrompt = vi.fn(
  async (..._a: unknown[]) =>
    null as "ask" | "asked" | { ask: true; button: { title: string; payload: string } } | null,
);
// Карточка с «Купить», ушедшая покупателю за последние минуты; кодовое слово правила.
const recentBuyDmButton = vi.fn(
  async (..._a: unknown[]) => null as { title: string; payload: string } | null,
);
const isDmCodeWord = vi.fn(async (..._a: unknown[]) => false);
// Магазин в переписке — отдельный модуль со своими тестами; здесь важно, дошло ли до него.
const expressFromAutomation = vi.fn(async (..._a: unknown[]) => true);
vi.mock("./shop.server", () => ({
  handleShopMessage: async (_ctx: unknown, customer: unknown) => ({ outcome: "handled", customer }),
  expressFromAutomation: (...a: unknown[]) => expressFromAutomation(...a),
}));
vi.mock("./automations.server", () => ({
  // Правила Zernio «комментарий → Директ» (охрана «менеджер в чате»): правил нет.
  liveAutomationApi: { list: async () => [] },
  ownsZernioAccount: () => true,
  deliverPendingTwoStepDm: (...a: unknown[]) => deliverPendingTwoStepDm(...(a as [])),
  deliverTwoStepFromDm: (...a: unknown[]) => deliverTwoStepFromDm(...(a as [])),
  deliverTwoStepForDmKeyword: (...a: unknown[]) => deliverTwoStepForDmKeyword(...a),
  plusAnswersUnknownPrompt: (...a: unknown[]) => plusAnswersUnknownPrompt(...a),
  twoStepJustDelivered,
  recentBuyDmButton: (...a: unknown[]) => recentBuyDmButton(...a),
  isDmCodeWord: (...a: unknown[]) => isDmCodeWord(...a),
  PLUS_AFTER_CARD_MS: 5 * 60_000,
  getAutomationsMeta: async () => ({}),
}));
vi.mock("./shop/catalog.server", async (orig) => ({
  ...(await orig<typeof import("./shop/catalog.server")>()),
  listedSectionByName: vi.fn(async () => null),
}));

// Б9: сам разбор «позови человека» и карточка — в human-call.test.ts; здесь — что слово доходит до него.
const callHuman = vi.fn(async (_c: unknown, cu: Customer, _m: unknown) => ({
  handled: true,
  customer: cu,
  note: "позвали продавца",
}));
vi.mock("./human-call", async (orig) => ({
  ...(await orig<typeof import("./human-call")>()),
  callHuman,
}));

const { handleZernioMessage } = await import("./handle-message");

const ctx = {
  tenant: { id: "b", vertical: "digital", modules: { whatsapp: true }, settings: {} },
} as unknown as TenantContext;

describe("консультант и менеджер из приложения", () => {
  it("менеджер ответил из приложения — консультант молчит, ставит паузу и пишет это итогом события", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const transport = {
      send,
      tail: async () => [
        {
          direction: "incoming",
          message: "есть в наличии?",
          createdAt: new Date(Date.now() - 120_000).toISOString(),
        },
        {
          direction: "outgoing",
          message: "Да, есть, сейчас пришлю фото",
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    } as unknown as ZernioTransport;
    const r = await handleZernioMessage(
      ctx,
      {
        account: { platform: "whatsapp", accountId: "acc-1" } as never,
        conversation: { id: "conv-1" } as never,
        message: { text: "а размер?", sender: { id: "77001112233" } } as never,
      } as never,
      transport,
    );
    // Итог события уходит в zernio_logs (dispatch): видно, что проверка увидела менеджера.
    expect(r).toEqual({
      status: "processed",
      note: "менеджер отвечает из приложения — консультант на паузе",
    });
    expect(pauseConsultant).toHaveBeenCalledOnce();
    expect(runConsultant).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("«стоп» в WhatsApp", () => {
  const payload = (text: string) =>
    ({
      account: { platform: "whatsapp", accountId: "acc-1" } as never,
      conversation: { id: "conv-1" } as never,
      message: { text, sender: { id: "77001112233" } } as never,
    }) as never;
  const transport = () =>
    ({
      send: vi.fn(async () => ({ ok: true })),
      tail: async () => [],
    }) as unknown as ZernioTransport;

  it("вне оформления — отписка с подтверждением, консультант молчит", async () => {
    runConsultant.mockClear();
    setOptOut.mockClear();
    const t = transport();
    const r = await handleZernioMessage(ctx, payload("Стоп"), t);
    expect(r).toEqual({ status: "processed", note: "отписка от рассылок" });
    expect(setOptOut).toHaveBeenCalledWith(ctx, customer.userKey, true);
    expect(t.send).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      expect.stringContaining("Вернуться — напишите «подписаться»"),
      { platform: "whatsapp" },
    );
    expect(runConsultant).not.toHaveBeenCalled();
  });

  it("«подписаться» возвращает", async () => {
    setOptOut.mockClear();
    const r = await handleZernioMessage(ctx, payload("подписаться"), transport());
    expect(r.note).toBe("возврат к рассылкам");
    expect(setOptOut).toHaveBeenCalledWith(ctx, customer.userKey, false);
  });

  it("на шаге оформления «стоп» не отписывает", async () => {
    setOptOut.mockClear();
    const inFlow = { ...customer, state: { ...customer.state, mode: "awaiting_contact" } };
    const { upsertCustomer } = await import("@/core/customers/customers");
    vi.mocked(upsertCustomer).mockResolvedValueOnce(inFlow as Customer);
    const r = await handleZernioMessage(ctx, payload("стоп"), transport());
    expect(r.note).not.toBe("отписка от рассылок");
    expect(setOptOut).not.toHaveBeenCalled();
  });
});

describe("Comment-to-DM: второй быстрый «+»", () => {
  const igCtx = {
    tenant: { id: "b", vertical: "digital", modules: { instagram: true }, settings: {} },
  } as unknown as TenantContext;
  const igEvent = (message: Record<string, unknown>, metadata?: Record<string, unknown>) =>
    ({
      account: { platform: "instagram", accountId: "acc-1" },
      conversation: { id: "conv-1" },
      message: {
        platform: "instagram",
        sender: { id: "ig-1", username: "boris" },
        ...message,
      },
      ...(metadata ? { metadata } : {}),
    }) as never;
  const transport = { send: vi.fn(async () => ({ ok: true })), tail: async () => [] };

  it("второе сообщение только что ушло — «+» не разбирается дальше", async () => {
    twoStepJustDelivered.mockResolvedValueOnce(true);
    const r = await handleZernioMessage(
      igCtx,
      igEvent({ text: "+" }),
      transport as unknown as ZernioTransport,
    );
    expect(r).toEqual({ status: "processed", note: "второе сообщение по комментарию" });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("«+» обогнал вебхук комментария — второе сообщение уходит на этот же «+»", async () => {
    const { PLUS_WAIT } = await import("./handle-message");
    PLUS_WAIT.ms = 0;
    deliverPendingTwoStepDm.mockClear();
    deliverPendingTwoStepDm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r = await handleZernioMessage(
      igCtx,
      igEvent({ text: "+" }),
      transport as unknown as ZernioTransport,
    );
    expect(r).toEqual({ status: "processed", note: "второе сообщение по комментарию" });
    expect(deliverPendingTwoStepDm).toHaveBeenCalledTimes(2);
    deliverPendingTwoStepDm.mockClear();
  });

  it("вебхука комментария нет — второе по первому сообщению в переписке, «+» не уходит в обращение (#25)", async () => {
    deliverTwoStepFromDm.mockClear();
    deliverTwoStepFromDm.mockResolvedValueOnce(true);
    const r = await handleZernioMessage(
      igCtx,
      igEvent({ text: "+" }),
      transport as unknown as ZernioTransport,
    );
    expect(r).toEqual({ status: "processed", note: "второе сообщение по комментарию" });
    expect(deliverTwoStepFromDm).toHaveBeenCalledWith(igCtx, {
      accountId: "acc-1",
      conversationId: "conv-1",
      username: "boris",
      senderId: "ig-1",
      express: expect.any(Function),
    });
    deliverTwoStepFromDm.mockClear();
  });

  it("заказ из автоматизации — только на явное согласие: «+» оформляет, вопрос и «❤️» — нет (Копилка #115, #121)", async () => {
    const shopCtx = {
      tenant: { ...igCtx.tenant, modules: { instagram: true, dm_shop: true } },
    } as unknown as TenantContext;
    const t = transport as unknown as ZernioTransport;
    const expressFor = async (message: Record<string, unknown>) => {
      deliverPendingTwoStepDm.mockClear();
      expressFromAutomation.mockClear();
      await handleZernioMessage(shopCtx, igEvent(message), t);
      const who = (deliverPendingTwoStepDm.mock.calls[0] as unknown[])[1] as {
        express: (id: string) => Promise<boolean>;
      };
      return { ok: await who.express("p-1"), calls: expressFromAutomation.mock.calls.length };
    };
    expect(await expressFor({ text: "+" })).toEqual({ ok: true, calls: 1 });
    expect(await expressFor({ text: "Хочу" })).toEqual({ ok: true, calls: 1 });
    expect(await expressFor({ text: "Здравствуйте. А в Беларусь 🇧🇾 высылаете?" })).toEqual({
      ok: false,
      calls: 0,
    });
    expect(await expressFor({ text: "❤️" })).toEqual({ ok: false, calls: 0 });
    expect(
      await expressFor({ text: "", attachments: [{ type: "image", url: "https://cdn.test/i" }] }),
    ).toEqual({ ok: false, calls: 0 });
  });

  it("«+» на чужое сообщение с призывом — вопрос, какой товар, а не заказ и не обращение (Копилка #144)", async () => {
    const shopCtx = {
      tenant: { ...igCtx.tenant, modules: { instagram: true, dm_shop: true } },
    } as unknown as TenantContext;
    const t = { send: vi.fn(async () => ({ ok: true })), tail: async () => [] };
    const { PLUS_WAIT } = await import("./handle-message");
    PLUS_WAIT.ms = 0;
    plusAnswersUnknownPrompt.mockResolvedValueOnce("ask");
    expressFromAutomation.mockClear();
    createTicket.mockClear();
    const r = await handleZernioMessage(
      shopCtx,
      igEvent({ text: "+" }),
      t as unknown as ZernioTransport,
    );
    expect(r).toEqual({ status: "processed", note: "«+» без правила — спросили, какой товар" });
    expect(t.send).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      expect.stringContaining("какой материал вас интересует"),
      {
        platform: "instagram",
        buttons: [{ type: "postback", title: "📚 Каталог", payload: "CATALOG" }],
      },
    );
    expect(expressFromAutomation).not.toHaveBeenCalled();
    expect(createTicket).not.toHaveBeenCalled();
    // Второй «+» — вопрос уже задан, молчим.
    plusAnswersUnknownPrompt.mockResolvedValueOnce("asked");
    t.send.mockClear();
    const again = await handleZernioMessage(
      shopCtx,
      igEvent({ text: "+" }),
      t as unknown as ZernioTransport,
    );
    expect(again.note).toBe("«+» без правила — вопрос о товаре уже задан");
    expect(t.send).not.toHaveBeenCalled();
    // В исходящем сообщении с призывом узнан товар каталога — его кнопка идёт рядом с «Каталогом».
    plusAnswersUnknownPrompt.mockResolvedValueOnce({
      ask: true,
      button: { title: "🛒 405. Книжка-подс…", payload: "PROD:p-405" },
    });
    t.send.mockClear();
    await handleZernioMessage(shopCtx, igEvent({ text: "+" }), t as unknown as ZernioTransport);
    expect(t.send).toHaveBeenCalledWith(
      "conv-1",
      "acc-1",
      expect.stringContaining("какой материал вас интересует"),
      {
        platform: "instagram",
        buttons: [
          { type: "postback", title: "🛒 405. Книжка-подс…", payload: "PROD:p-405" },
          { type: "postback", title: "📚 Каталог", payload: "CATALOG" },
        ],
      },
    );
  });

  it("«/start» сразу после второго сообщения при магазине в Direct идёт магазину", async () => {
    twoStepJustDelivered.mockClear();
    twoStepJustDelivered.mockResolvedValueOnce(true);
    const shopCtx = {
      tenant: { ...igCtx.tenant, modules: { instagram: true, dm_shop: true } },
    } as unknown as TenantContext;
    const r = await handleZernioMessage(
      shopCtx,
      igEvent({ text: "/start" }),
      transport as unknown as ZernioTransport,
    );
    expect(r).toEqual({ status: "processed", note: "магазин" });
  });

  it("чат с менеджером: «/start» всё равно идёт магазину, вопрос — нет", async () => {
    const { inboundIntercepted } = await import("@/core/chat/chat");
    vi.mocked(inboundIntercepted).mockResolvedValue(true);
    const shopCtx = {
      tenant: { ...igCtx.tenant, modules: { instagram: true, dm_shop: true, manager_chat: true } },
    } as unknown as TenantContext;
    const t = transport as unknown as ZernioTransport;
    const start = await handleZernioMessage(shopCtx, igEvent({ text: "/start" }), t);
    const question = await handleZernioMessage(shopCtx, igEvent({ text: "а когда?" }), t);
    vi.mocked(inboundIntercepted).mockResolvedValue(false);
    expect(start).toEqual({ status: "processed", note: "магазин" });
    expect(question).toEqual({ status: "processed", note: "менеджер ведёт диалог в панели" });
  });

  it("нажатие кнопки второго сообщения сразу после него идёт дальше", async () => {
    twoStepJustDelivered.mockClear();
    twoStepJustDelivered.mockResolvedValue(true);
    const r = await handleZernioMessage(
      igCtx,
      igEvent({ text: null }, { postbackPayload: "CATALOG" }),
      transport as unknown as ZernioTransport,
    );
    twoStepJustDelivered.mockResolvedValue(false);
    expect(r.note).not.toBe("второе сообщение по комментарию");
    expect(twoStepJustDelivered).not.toHaveBeenCalled();
  });

  it("кодовое слово из рилса прямо в Direct — сообщение правила, не обращение (Копилка, 09.10)", async () => {
    deliverTwoStepForDmKeyword.mockClear();
    deliverTwoStepForDmKeyword.mockResolvedValueOnce(true);
    const t = transport as unknown as ZernioTransport;
    const r = await handleZernioMessage(igCtx, igEvent({ text: "Палитра" }), t);
    expect(r).toEqual({ status: "processed", note: "кодовое слово в Direct — сообщение правила" });
    expect(deliverTwoStepForDmKeyword.mock.calls[0]![2]).toBe("Палитра");
  });
});

describe("быстрый вопрос «Связаться с продавцом»", () => {
  const asked = {
    ...customer,
    platform: "instagram",
    state: { ...customer.state, direct: { contact_requested_at: new Date().toISOString() } },
  } as unknown as Customer;
  const igCtx = (modules: Record<string, boolean> = {}) =>
    ({
      tenant: { ...ctx.tenant, modules: { instagram: true, ...modules } },
    }) as unknown as TenantContext;
  const event = (text: string) =>
    ({
      account: { platform: "instagram", accountId: "acc-1" },
      conversation: { id: "conv-1" },
      message: { text, sender: { id: "ig-1" } },
    }) as never;
  const transport = { send: vi.fn(async () => ({ ok: true })), tail: async () => [] };
  const run = async (text: string, modules?: Record<string, boolean>) => {
    const { upsertCustomer } = await import("@/core/customers/customers");
    vi.mocked(upsertCustomer).mockResolvedValueOnce(asked);
    return handleZernioMessage(
      igCtx(modules),
      event(text),
      transport as unknown as ZernioTransport,
    );
  };
  const reset = () => {
    for (const f of [pauseConsultant, runConsultant, notifyAdminsHtml, createTicket]) f.mockClear();
    claimContactRequest.mockReset();
    claimContactRequest.mockImplementation(async (_ctx, c) => c);
  };

  it("два сообщения подряд — продавцу одна пересылка, консультант молчит", async () => {
    reset();
    claimContactRequest.mockImplementationOnce(async (_ctx, c) => c);
    claimContactRequest.mockImplementationOnce(async () => null);
    const a = await run("Нужна консультация по размеру");
    const b = await run("и по цвету");
    expect(a.note).toBe("просьба связаться — вопрос продавцу");
    expect(b.note).toBe("просьба связаться — вопрос уже у продавца");
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    expect(String(notifyAdminsHtml.mock.calls[0]![1])).toContain("Нужна консультация по размеру");
    expect(pauseConsultant).toHaveBeenCalledOnce();
    expect(runConsultant).not.toHaveBeenCalled();
  });

  it("модуль «Поддержка» — одно обращение вместо уведомления «просит связаться»", async () => {
    reset();
    claimContactRequest.mockImplementationOnce(async (_ctx, c) => c);
    claimContactRequest.mockImplementationOnce(async () => null);
    const a = await run("Нужна консультация", { helpdesk: true, manager_chat: true });
    await run("ещё вопрос", { helpdesk: true, manager_chat: true });
    expect(a.note).toBe("просьба связаться — обращение #7");
    expect(createTicket).toHaveBeenCalledOnce();
    expect(notifyAdminsHtml).toHaveBeenCalledOnce();
    expect(String(notifyAdminsHtml.mock.calls[0]![1])).toContain("Новое обращение #7");
    expect(runConsultant).not.toHaveBeenCalled();
  });
});

describe("Б9: «позови человека» в Direct и WhatsApp", () => {
  const shopCtx = {
    tenant: {
      id: "b",
      vertical: "digital",
      modules: { whatsapp: true, wa_shop: true },
      settings: {},
    },
  } as unknown as TenantContext;
  const payload = (text: string) =>
    ({
      account: { platform: "whatsapp", accountId: "acc-1" } as never,
      conversation: { id: "conv-1" } as never,
      message: { text, sender: { id: "77001112233" } } as never,
    }) as never;
  const transport = {
    send: vi.fn(async () => ({ ok: true })),
    tail: async () => [],
  } as unknown as ZernioTransport;

  it("слово «человек» в магазине — карточка продавцу, магазин не отвечает", async () => {
    callHuman.mockClear();
    const r = await handleZernioMessage(shopCtx, payload("Позовите человека"), transport);
    expect(r).toEqual({ status: "processed", note: "позвали продавца" });
    expect(callHuman).toHaveBeenCalledOnce();
  });

  it("обычный вопрос и фраза внутри длинного текста слово не запускают", async () => {
    callHuman.mockClear();
    await handleZernioMessage(shopCtx, payload("Сколько человек поместится?"), transport);
    await handleZernioMessage(shopCtx, payload("А размер какой?"), transport);
    expect(callHuman).not.toHaveBeenCalled();
  });

  it("без модуля магазина слово уходит консультанту, как раньше", async () => {
    callHuman.mockClear();
    await handleZernioMessage(ctx, payload("человек"), transport);
    expect(callHuman).not.toHaveBeenCalled();
  });
});
