import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";
import type { ParsedZernioMessage } from "./message";
import {
  handleSellerOutgoing,
  isExplicitCommand,
  pauseEndsAt,
  sellerPauseActive,
} from "./seller-pause";

const notify = vi.hoisted(() => vi.fn(async (_c: unknown, _h: string, _o?: unknown) => 1));
vi.mock("@/channels/telegram/notify", () => ({ notifyAdminsHtml: notify }));
vi.mock("@/core/catalog/low-stock", () => ({ sellerLocale: async () => "ru" }));

/** Б3: продавец ответил руками — бот на паузе, команды и чек работают. */
beforeEach(() => notify.mockClear());

const BOT = "bot-1";
const NOW = Date.parse("2026-10-04T10:00:00Z"); // 15:00 в Алматы
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function setup(state: Record<string, unknown> = { locale: "ru" }) {
  const db = fakeDb();
  db.tables.bot_users = [{ id: "u1", bot_id: BOT, user_key: "instagram_9", state }];
  const ctx = {
    tenant: { id: BOT, modules: {}, settings: { default_locale: "ru" } },
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
  const tail = vi.fn(async () => [] as unknown[]);
  const transport = { tail } as unknown as ZernioTransport;
  const msg = (m: Partial<ParsedZernioMessage> = {}): ParsedZernioMessage =>
    ({
      conversationId: "c1",
      accountId: "a1",
      platform: "instagram",
      senderId: "9",
      text: "а размер какой?",
      postbackPayload: null,
      nativeOrder: null,
      attachments: [],
      outgoing: false,
      ...m,
    }) as ParsedZernioMessage;
  return { db, ctx, customer, tail, transport, msg };
}

const seller = (min: number, text = "Здравствуйте, сейчас отвечу", via: string | null = null) => ({
  direction: "outgoing",
  message: text,
  sentVia: via,
  createdAt: ago(min),
});

describe("конец паузы", () => {
  it("15/30/60 минут от реплики продавца", () => {
    const t = Date.parse(ago(0));
    expect(pauseEndsAt(t, "15", "Asia/Almaty")).toBe(t + 15 * 60_000);
    expect(pauseEndsAt(t, "30", "Asia/Almaty")).toBe(t + 30 * 60_000);
    expect(pauseEndsAt(t, "60", "Asia/Almaty")).toBe(t + 60 * 60_000);
  });
  it("«до конца дня» — до 23:59:59 по часам магазина", () => {
    expect(new Date(pauseEndsAt(NOW, "day", "Asia/Almaty")).toISOString()).toBe(
      "2026-10-04T18:59:59.999Z",
    );
  });
});

describe("явные команды, которые бот понимает и в паузе", () => {
  const cmd = (m: Partial<ParsedZernioMessage>, mode?: string) =>
    isExplicitCommand({ ...setup().msg(), ...m }, mode);
  it("кнопка, «меню», «корзина», «старт», корзина из каталога", () => {
    expect(cmd({ postbackPayload: "CART" })).toBe(true);
    expect(cmd({ text: "меню" })).toBe(true);
    expect(cmd({ text: "Корзина" })).toBe(true);
    expect(cmd({ text: "/start" })).toBe(true);
  });
  it("чек на шаге оплаты — да, фото вне оплаты и обычная фраза — нет", () => {
    const photo = [{ type: "image", url: "u", index: 0 }];
    expect(cmd({ text: "", attachments: photo }, "awaiting_proof")).toBe(true);
    expect(cmd({ text: "", attachments: photo }, "idle")).toBe(false);
    expect(cmd({ text: "а размер какой?" })).toBe(false);
  });
});

describe("пауза перед ответом бота", () => {
  it("продавец писал 10 минут назад — пауза, продавцу одна строка", async () => {
    const { ctx, customer, transport, tail, msg } = setup();
    tail.mockResolvedValue([seller(10)]);
    const r = await sellerPauseActive(ctx, customer, msg(), transport, "30", NOW);
    expect(r.paused).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![1]).toContain("Бот на паузе в диалоге с @anna");
    notify.mockClear();
    // Следующее сообщение той же паузы — молчим, не повторяем строку.
    const again = await sellerPauseActive(ctx, r.customer, msg(), transport, "30", NOW + 60_000);
    expect(again.paused).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("через 30 минут бот снова отвечает", async () => {
    const { ctx, customer, transport, tail, msg } = setup();
    tail.mockResolvedValue([seller(10)]);
    const r = await sellerPauseActive(ctx, customer, msg(), transport, "30", NOW + 20 * 60_000);
    expect(r.paused).toBe(false); // 10 + 20 = 30 минут от реплики
  });

  it("настройка «до конца дня» держит паузу дольше часа, «15 минут» — короче", async () => {
    const a = setup();
    a.tail.mockResolvedValue([seller(120)]);
    expect(
      (await sellerPauseActive(a.ctx, a.customer, a.msg(), a.transport, "day", NOW)).paused,
    ).toBe(true);
    const b = setup();
    b.tail.mockResolvedValue([seller(16)]);
    expect(
      (await sellerPauseActive(b.ctx, b.customer, b.msg(), b.transport, "15", NOW)).paused,
    ).toBe(false);
  });

  it("«меню» в паузе работает и переписку даже не читает", async () => {
    const { ctx, customer, transport, tail, msg } = setup();
    tail.mockResolvedValue([seller(1)]);
    const r = await sellerPauseActive(ctx, customer, msg({ text: "меню" }), transport, "30", NOW);
    expect(r.paused).toBe(false);
    expect(tail).not.toHaveBeenCalled();
  });

  it("свои ответы бота (через API) и их повтор словами не ставят паузу", async () => {
    const { ctx, customer, transport, tail, msg } = setup({
      locale: "ru",
      direct: { last_reply: "Каталог: выберите раздел" },
    });
    tail.mockResolvedValue([
      seller(2, "Выберите товар", "api"),
      seller(1, "Каталог: выберите раздел", null),
    ]);
    const r = await sellerPauseActive(ctx, customer, msg(), transport, "30", NOW);
    expect(r.paused).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("поле sentVia не пришло — не знаем, кто писал: бот не замолкает", async () => {
    const { ctx, customer, transport, tail, msg } = setup();
    tail.mockResolvedValue([{ direction: "outgoing", message: "что-то", createdAt: ago(1) }]);
    expect((await sellerPauseActive(ctx, customer, msg(), transport, "30", NOW)).paused).toBe(
      false,
    );
  });

  it("переписку не прочитали — пауза по памяти события, иначе бот отвечает", async () => {
    const a = setup();
    a.tail.mockRejectedValue(new Error("Zernio 500"));
    expect(
      (await sellerPauseActive(a.ctx, a.customer, a.msg(), a.transport, "30", NOW)).paused,
    ).toBe(false);
    const b = setup({ locale: "ru", direct: { seller_at: ago(5), seller_noted: ago(5) } });
    b.tail.mockRejectedValue(new Error("Zernio 500"));
    expect(
      (await sellerPauseActive(b.ctx, b.customer, b.msg(), b.transport, "30", NOW)).paused,
    ).toBe(true);
  });

  it("два вебхука одновременно — строка продавцу уходит один раз", async () => {
    notify.mockClear();
    const { ctx, customer, transport, tail, msg } = setup();
    tail.mockResolvedValue([seller(3)]);
    const [a, b] = await Promise.all([
      sellerPauseActive(ctx, customer, msg(), transport, "30", NOW),
      sellerPauseActive(ctx, customer, msg(), transport, "30", NOW),
    ]);
    expect(a.paused && b.paused).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("событие «исходящее сообщение продавца»", () => {
  it("человек написал — пауза записана, продавцу одна строка; повтор события тихий", async () => {
    notify.mockClear();
    const { ctx, customer, msg, db } = setup();
    const out = msg({ outgoing: true, sentVia: null, text: "Добрый день!", sentAt: ago(1) });
    expect(await handleSellerOutgoing(ctx, customer, out, "30", undefined, NOW)).toBe(true);
    expect(
      (db.tables.bot_users![0]!.state as { direct: { seller_at: string } }).direct.seller_at,
    ).toBe(ago(1));
    expect(notify).toHaveBeenCalledTimes(1);
    await handleSellerOutgoing(ctx, customer, out, "30", undefined, NOW);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("исходящее самого бота (API) и рассылка — не пауза", async () => {
    notify.mockClear();
    const { ctx, customer, msg } = setup();
    for (const via of ["api", "broadcast", "workflow"])
      expect(
        await handleSellerOutgoing(
          ctx,
          customer,
          msg({ outgoing: true, sentVia: via, text: "Каталог", sentAt: ago(1) }),
          "30",
          undefined,
          NOW,
        ),
      ).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
