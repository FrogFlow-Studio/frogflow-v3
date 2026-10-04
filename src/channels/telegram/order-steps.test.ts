import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";
import type { TelegramApi } from "./api";
import {
  orderStepKeyboard,
  orderTrackRefLine,
  orderWriteRefLine,
  orderWriteRefOf,
} from "./order-notify-keys";

/**
 * Б4: кнопки статуса физического заказа и «Написать покупателю» под
 * уведомлением продавцу. Шаг — настоящий setPhysicalStatus с условной записью.
 */
const SELLER = 42;
const BUYER = 77;
const zernioSent: string[] = [];
let zernioResult: { ok: boolean; failure?: unknown } = { ok: true };
vi.mock("@/core/notify/recipients", () => ({ shopAdminIds: async () => [String(SELLER)] }));
vi.mock("@/channels/zernio/outbound.server", async (orig) => ({
  ...(await orig<typeof import("@/channels/zernio/outbound.server")>()),
  zernioTargetForOrder: async (_c: unknown, o: { platform: string }) =>
    o.platform === "instagram"
      ? { conversationId: "c", accountId: "a", platform: "instagram", locale: "ru" }
      : null,
  sendToZernioTarget: async (_t: unknown, text: string) => {
    zernioSent.push(text);
    return true;
  },
  sendToZernioTargetResult: async (_t: unknown, text: string) => {
    zernioSent.push(text);
    return zernioResult;
  },
}));

const { handleTelegramUpdate } = await import("./handle-update");

function setup(order: Record<string, unknown> = {}) {
  const db: FakeDb = fakeDb({
    unique: { app_settings: [["bot_id", "key"]], zernio_logs: [["event_id"]] },
  });
  db.tables.app_settings = [];
  db.tables.zernio_logs = [];
  db.tables.bot_users = [
    {
      id: "u-b",
      user_key: userKey("telegram", BUYER),
      platform: "telegram",
      telegram_id: BUYER,
      state: { locale: "ru" },
    },
  ];
  db.tables.orders = [
    {
      id: 7,
      order_no: 7,
      display_no: 7,
      bot_id: "bot-1",
      telegram_id: BUYER,
      platform: "telegram",
      status: "ready",
      total: 15000,
      currency: "KZT",
      fulfillment_kind: "physical",
      order_items: [],
      ...order,
    },
  ];
  const ctx = {
    tenant: {
      id: "bot-1",
      status: "active",
      vertical: "digital",
      modules: {},
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      return { ok: true, result: {} };
    }),
  } as unknown as TelegramApi;
  const press = (data: string, from = SELLER) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 1,
      callback_query: {
        id: "cq",
        from: { id: from, is_bot: false, first_name: "S" },
        data,
        message: { message_id: 5, date: 0, chat: { id: from, type: "private" } },
      },
    } as never);
  const reply = (text: string, replyTo: string, from = SELLER) =>
    handleTelegramUpdate(ctx, api, {
      update_id: 2,
      message: {
        message_id: 9,
        chat: { id: from, type: "private" },
        from: { id: from, is_bot: false, first_name: "S" },
        text,
        reply_to_message: { message_id: 8, text: replyTo },
      },
    } as never);
  const texts = () =>
    calls.filter(([m]) => m === "sendMessage").map(([, p]) => `${p.chat_id}: ${p.text}`);
  const events = () =>
    (db.tables.zernio_logs ?? []).filter((r) => String(r.event_type).startsWith("order.status"));
  return { db, calls, press, reply, texts, events, order: () => db.tables.orders![0]! };
}

beforeEach(() => {
  zernioSent.length = 0;
  zernioResult = { ok: true };
});

describe("кнопки шага физического заказа", () => {
  it("«Отправлен»: заказ выдан, одно событие, покупателю одно сообщение", async () => {
    const { press, order, events, texts } = setup();
    await press("ost:7:shipped");
    expect(order().status).toBe("delivered");
    expect(events()).toHaveLength(1);
    expect(events()[0]!.payload).toMatchObject({ to: "delivered", step: "shipped" });
    expect(texts().filter((t) => t.startsWith(`${BUYER}:`))).toEqual([
      `${BUYER}: 📦 Заказ #7 отправлен. Спасибо!`,
    ]);
  });

  it("двойное нажатие «Отправлен»: одно событие, одно сообщение покупателю", async () => {
    const { press, events, texts } = setup();
    await Promise.all([press("ost:7:shipped"), press("ost:7:shipped")]);
    await press("ost:7:shipped");
    expect(events()).toHaveLength(1);
    expect(texts().filter((t) => t.startsWith(`${BUYER}:`))).toHaveLength(1);
    expect(texts().some((t) => t.includes("уже изменился"))).toBe(true);
  });

  it("кнопка устаревшего статуса: «статус уже изменился», ничего не пишет", async () => {
    const { press, order, events, texts } = setup({ status: "delivered" });
    await press("ost:7:ready");
    expect(order().status).toBe("delivered");
    expect(events()).toEqual([]);
    expect(texts()).toEqual([
      `${SELLER}: Статус заказа #7 уже изменился (delivered) — обновите уведомление.`,
    ]);
  });

  it("цепочка: В работу → Собран → Выдан, кнопки обновляются под следующий шаг", async () => {
    const { press, order, calls } = setup({ status: "accepted" });
    await press("ost:7:work");
    expect(order().status).toBe("in_production");
    await press("ost:7:ready");
    expect(order().status).toBe("ready");
    await press("ost:7:done");
    expect(order().status).toBe("delivered");
    expect(calls.filter(([m]) => m === "sendMessage").length).toBe(6);
  });

  it("не продавец и не физический заказ: ничего не меняется", async () => {
    const a = setup();
    await a.press("ost:7:shipped", 999);
    expect(a.order().status).toBe("ready");
    const b = setup({ fulfillment_kind: "digital" });
    await b.press("ost:7:shipped");
    expect(b.order().status).toBe("ready");
  });

  it("заказ из Instagram: покупателю уходит в его канал", async () => {
    const { press } = setup({ platform: "instagram", telegram_id: -5 });
    await press("ost:7:done");
    expect(zernioSent).toEqual(["✅ Заказ выдан. Спасибо! — #7"]);
  });
});

describe("«Написать покупателю»", () => {
  it("кнопка просит ответить свайпом, ответ уходит покупателю в Telegram", async () => {
    const { press, reply, texts } = setup();
    await press("owr:7");
    const prompt = texts().at(-1)!;
    expect(orderWriteRefOf(prompt)).toBe(7);
    await reply("Заказ готов, заберёте завтра?", prompt);
    expect(texts()).toContain(`${BUYER}: Заказ готов, заберёте завтра?`);
    expect(texts().at(-1)).toBe(`${SELLER}: ✅ Сообщение по заказу #7 отправлено покупателю.`);
  });

  it("Instagram вне окна 24 часа: честный отказ", async () => {
    const { reply, texts } = setup({ platform: "instagram", telegram_id: -5 });
    zernioResult = { ok: false, failure: { platformCode: 131047 } };
    await reply("Здравствуйте", orderWriteRefLine(7));
    expect(texts().at(-1)).toContain("больше 24 часов");
    expect(zernioSent).toEqual(["Здравствуйте"]);
  });

  it("заказ с сайта: чата нет, сказано прямо", async () => {
    const { press, texts } = setup({ platform: "web", telegram_id: 0 });
    await press("owr:7");
    expect(texts().at(-1)).toContain("нет чата");
  });

  it("чужой свайп (не продавец) не уходит покупателю", async () => {
    const { reply, texts } = setup();
    await reply("Привет", orderWriteRefLine(7), 999);
    expect(texts().filter((t) => t.startsWith(`${BUYER}:`))).toEqual([]);
  });
});

describe("клавиатура по статусу", () => {
  it("кнопки по статусам и четыре языка", () => {
    const flat = (s: string, l: "ru" | "kk" | "en" | "uz") =>
      orderStepKeyboard({ id: 7, status: s }, l)
        .flat()
        .map((b) => b.callback_data);
    expect(flat("accepted", "ru")).toEqual(["ost:7:work", "owr:7"]);
    expect(flat("in_production", "kk")).toEqual(["ost:7:ready", "owr:7"]);
    expect(flat("ready", "en")).toEqual(["ost:7:shipped", "ost:7:done", "otr:7", "owr:7"]);
    expect(flat("delivered", "uz")).toEqual([]);
    for (const l of ["ru", "kk", "en", "uz"] as const)
      for (const b of orderStepKeyboard({ id: 7, status: "ready" }, l).flat())
        expect(b.text.length).toBeGreaterThan(3);
  });
});

describe("Б12: «Отправлен + трек»", () => {
  it("кнопка просит номер ответом; ответ — заказ отправлен, покупателю номер и ссылка СДЭК один раз", async () => {
    const { press, reply, order, events, texts, db } = setup();
    await press("otr:7");
    const prompt = texts().at(-1)!;
    expect(prompt).toContain(orderTrackRefLine(7));
    await reply("1234567890", prompt);
    expect(order().status).toBe("delivered");
    const buyer = texts().filter((t) => t.startsWith(`${BUYER}:`));
    expect(buyer).toHaveLength(1);
    expect(buyer[0]).toContain("Трек-номер: 1234567890 (СДЭК)");
    expect(buyer[0]).toContain("https://www.cdek.ru/ru/tracking?order_id=1234567890");
    expect(
      events().filter((e) => (e.payload as { step?: string }).step === "shipped"),
    ).toHaveLength(1);
    expect(
      (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "order.tracking"),
    ).toHaveLength(1);
  });

  it("двойной ответ тем же номером — покупателю одно сообщение, статус один раз", async () => {
    const { reply, texts, events } = setup();
    const ref = orderTrackRefLine(7);
    await Promise.all([reply("RR123456789KZ", ref), reply("RR123456789KZ", ref)]);
    await reply("rr 123456789 kz", ref);
    expect(texts().filter((t) => t.startsWith(`${BUYER}:`))).toHaveLength(1);
    expect(
      events().filter((e) => (e.payload as { step?: string }).step === "shipped"),
    ).toHaveLength(1);
    expect(texts().some((t) => t.includes("второго сообщения нет"))).toBe(true);
  });

  it("исправленный номер уходит покупателю новым сообщением, статус не двоится", async () => {
    const { reply, texts, events } = setup();
    await reply("1234567890", orderTrackRefLine(7));
    await reply("1234567891", orderTrackRefLine(7));
    expect(texts().filter((t) => t.startsWith(`${BUYER}:`))).toHaveLength(2);
    expect(
      events().filter((e) => (e.payload as { step?: string }).step === "shipped"),
    ).toHaveLength(1);
  });

  it("неизвестный формат — номер текстом без ссылки; Казпочта — ссылка на сайт", async () => {
    const a = setup();
    await a.reply("AB-77-XYZ-99", orderTrackRefLine(7));
    const t = a.texts().find((x) => x.startsWith(`${BUYER}:`))!;
    expect(t).toContain("Трек-номер: AB-77-XYZ-99");
    expect(t).not.toContain("http");
    const b = setup();
    await b.reply("RR123456789KZ", orderTrackRefLine(7));
    expect(b.texts().find((x) => x.startsWith(`${BUYER}:`))).toContain("(Казпочта)");
  });

  it("не номер — подсказка, статус не меняется; заказ ещё не собран — просьба нажать «Собран»", async () => {
    const a = setup();
    await a.reply("привет, отправил", orderTrackRefLine(7));
    expect(a.order().status).toBe("ready");
    expect(a.texts().at(-1)).toContain("Не похоже на трек-номер");
    const b = setup({ status: "in_production" });
    await b.reply("1234567890", orderTrackRefLine(7));
    expect(b.order().status).toBe("in_production");
    expect(b.texts().at(-1)).toContain("«Собран»");
  });

  it("не продавец: ничего не меняется; заказ из Instagram — номер в его канал", async () => {
    const a = setup();
    await a.reply("1234567890", orderTrackRefLine(7), 999);
    expect(a.order().status).toBe("ready");
    const b = setup({ platform: "instagram", telegram_id: -5 });
    await b.reply("1234567890", orderTrackRefLine(7));
    expect(zernioSent.join("\n")).toContain("Трек-номер: 1234567890");
  });
});
