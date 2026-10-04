import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";
import type { ParsedZernioMessage } from "./message";
import { sellerPauseActive } from "./seller-pause";
import { callHuman, humanCallCard, isHumanCallWord } from "./human-call";

const notify = vi.hoisted(() => vi.fn(async (_c: unknown, _h: string, _o?: unknown) => 1));
const recipients = vi.hoisted(() => ({ list: ["42"] }));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml: notify }));
vi.mock("@/core/notify/recipients", () => ({ adminRecipients: async () => recipients.list }));
vi.mock("@/core/catalog/low-stock", () => ({ sellerLocale: async () => "ru" }));
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => false,
  pauseConsultant: async (_c: unknown, c: unknown) => c,
}));

/** Б9: «позвать продавца» — пауза бота, карточка продавцу, один раз. */
beforeEach(() => {
  notify.mockClear();
  recipients.list = ["42"];
});

const NOW = Date.parse("2026-10-04T10:00:00Z");
const at = (min: number) => new Date(NOW - min * 60_000).toISOString();

function setup() {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  const state = { locale: "ru" };
  db.tables.bot_users = [{ id: "u1", bot_id: "bot-1", user_key: "instagram_9", state }];
  const ctx = {
    tenant: { id: "bot-1", modules: {}, settings: { default_locale: "ru" } },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const customer = {
    userKey: "instagram_9",
    platform: "instagram",
    telegramId: -9,
    username: "anna",
    firstName: "Анна",
    state,
  } as unknown as Customer;
  const sent: string[] = [];
  const tailMessages = [
    { direction: "incoming", message: "Здравствуйте", createdAt: at(10) },
    {
      direction: "outgoing",
      message: "Добрый день! Чем помочь?",
      sentVia: "api",
      createdAt: at(9),
    },
    { direction: "incoming", message: "Есть набор в синем?", createdAt: at(8) },
    { direction: "incoming", message: "<b>позовите</b> человека", createdAt: at(0) },
  ];
  const transport = {
    tail: vi.fn(async () => tailMessages),
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
  } as unknown as ZernioTransport;
  const msg = {
    conversationId: "c1",
    accountId: "a1",
    platform: "instagram",
    senderId: "9",
    text: "человек",
    postbackPayload: null,
    nativeOrder: null,
    attachments: [],
  } as unknown as ParsedZernioMessage;
  return { db, ctx, customer, transport, msg, sent };
}

describe("слово «позови человека»", () => {
  it.each([
    "человек",
    "Позовите человека!",
    "позвать продавца",
    "живой человек",
    "хочу поговорить с менеджером",
    "оператор пожалуйста",
    "сатушыны шақырыңыз",
    "тірі адам",
    "human",
    "I want a real person",
    "speak to a manager",
    "sotuvchi kerak",
    "jonli odam",
  ])("«%s» — просьба позвать", (t) => expect(isHumanCallWord(t)).toBe(true));

  it.each([
    "сколько человек в группе",
    "привет",
    "хочу заказать у продавца три набора",
    "",
    "123",
    "человек человек человек человек человек человек человек человек человек человек",
  ])("«%s» — не просьба", (t) => expect(isHumanCallWord(t)).toBe(false));
});

describe("карточка продавцу", () => {
  it("последние 3 сообщения, кто писал, HTML покупателя экранирован", () => {
    const card = humanCallCard("ru", "Анна <x>", "Instagram", [
      { direction: "incoming", message: "<b>a</b>", createdAt: at(2) },
      { direction: "outgoing", message: "b", createdAt: at(1) },
    ] as never);
    expect(card.html).toContain("Покупатель ждёт: Анна &lt;x&gt;");
    expect(card.html).toContain("— Покупатель: &lt;b&gt;a&lt;/b&gt;");
    expect(card.html).toContain("— Магазин: b");
  });
  it("переписка не прочиталась — об этом сказано, карточка уходит", () => {
    expect(humanCallCard("ru", "A", "Instagram", null).html).toContain("прочитать не удалось");
  });
  it("четыре языка", () => {
    for (const l of ["ru", "kk", "en", "uz"] as const)
      expect(humanCallCard(l, "A", "Instagram", []).hint.length).toBeGreaterThan(10);
  });
});

describe("позвать продавца", () => {
  it("карточка с тремя сообщениями и меткой для ответа; покупателю — одна строка", async () => {
    const { ctx, customer, transport, msg, sent } = setup();
    const r = await callHuman(ctx, customer, msg, transport, NOW);
    expect(r.handled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const html = notify.mock.calls[0]![1];
    expect(html).toContain("Покупатель ждёт: Анна");
    expect(html).toContain("— Покупатель: Есть набор в синем?");
    expect(html).toContain("— Магазин: Добрый день! Чем помочь?");
    expect(html).not.toContain("Здравствуйте");
    expect(html).toMatch(/\[#k:[a-z0-9]{6,12}\]/);
    expect(sent).toEqual(["🙋 Позвал продавца — он ответит вам здесь. Пока бот помолчит."]);
  });

  it("бот в диалоге замолкает на паузу продавца, без «вы ответили сами»", async () => {
    const { ctx, customer, transport, msg } = setup();
    await callHuman(ctx, customer, msg, transport, NOW);
    notify.mockClear();
    const { data } = await ctx.db
      .from("bot_users")
      .select("state")
      .eq("user_key", "instagram_9")
      .maybeSingle();
    const fresh = { ...customer, state: data!.state } as Customer;
    const gate = await sellerPauseActive(
      ctx,
      fresh,
      { ...msg, text: "а цена?" } as ParsedZernioMessage,
      { tail: async () => [] } as unknown as ZernioTransport,
      "30",
      NOW + 5 * 60_000,
    );
    expect(gate.paused).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("повтор слова и два одновременных: продавцу и покупателю по одному разу", async () => {
    const { ctx, customer, transport, msg, sent } = setup();
    await Promise.all([
      callHuman(ctx, customer, msg, transport, NOW),
      callHuman(ctx, customer, msg, transport, NOW),
    ]);
    const again = await callHuman(ctx, customer, msg, transport, NOW + 60_000);
    expect(again.handled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
  });

  it("через полчаса можно позвать снова", async () => {
    const { ctx, customer, transport, msg } = setup();
    await callHuman(ctx, customer, msg, transport, NOW);
    await callHuman(ctx, customer, msg, transport, NOW + 31 * 60_000);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("продавцу писать некуда: ничего не пишем, диалог идёт как обычно", async () => {
    recipients.list = [];
    const { ctx, customer, transport, msg, sent } = setup();
    const r = await callHuman(ctx, customer, msg, transport, NOW);
    expect(r.handled).toBe(false);
    expect(sent).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("переписка не прочиталась: карточка всё равно уходит", async () => {
    const { ctx, customer, transport, msg } = setup();
    (transport.tail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("503"));
    await callHuman(ctx, customer, msg, transport, NOW);
    expect(notify.mock.calls[0]![1]).toContain("прочитать не удалось");
  });
});
