import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { ZernioTransport } from "./api.server";

/** Модуль «Поддержка» в Instagram/WhatsApp: вопрос без консультанта — обращение с номером. */
let customer: Customer;
vi.mock("@/core/customers/customers", () => ({
  upsertCustomer: vi.fn(async () => customer),
  isBlocked: vi.fn(async () => false),
  setState: vi.fn(async (_ctx: unknown, c: Customer, state: Customer["state"]) => {
    customer = { ...c, state };
    return customer;
  }),
}));
vi.mock("@/core/instagram/direct-bot-settings", () => ({
  loadDirectBotSettings: vi.fn(async () => ({
    enabled: true,
    ignoreExcluded: false,
    scope: "all",
  })),
}));
vi.mock("@/core/consultant/engine.server", () => ({ consultantEnabled: async () => false }));
vi.mock("@/core/chat/chat", () => ({
  inboundIntercepted: async () => false,
  recordMessage: async () => {},
}));
vi.mock("./shop.server", () => ({
  handleShopMessage: async () => ({ outcome: "question", customer }),
}));
const notified: string[] = [];
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: vi.fn(async (_ctx: unknown, html: string) => {
    notified.push(html);
    return 1;
  }),
}));

const { handleZernioMessage } = await import("./handle-message");

let db: FakeDb;
const ctx = (modules: Record<string, boolean>) =>
  ({
    tenant: { id: "b", vertical: "flowers", modules, settings: {} },
    db,
  }) as unknown as TenantContext;
const ON = { whatsapp: true, wa_shop: true, manager_chat: true, helpdesk: true };
const payload = (text: string) =>
  ({
    account: { platform: "whatsapp", accountId: "acc-1" },
    conversation: { id: "conv-1" },
    message: { text, sender: { id: "77001112233", name: "Аня" } },
  }) as never;

let sent: string[];
const transport = () =>
  ({
    send: vi.fn(async (_c: string, _a: string, text: string) => {
      sent.push(text);
      return { ok: true };
    }),
    tail: async () => [],
  }) as unknown as ZernioTransport;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  customer = {
    userKey: "wa:77001112233",
    platform: "whatsapp",
    telegramId: -7,
    firstName: "Аня",
    state: {},
  } as unknown as Customer;
  sent = [];
  notified.length = 0;
});

describe("обращения из WhatsApp и Instagram", () => {
  it("вопрос — обращение #1, покупателю номер, продавцу уведомление", async () => {
    const r = await handleZernioMessage(ctx(ON), payload("Когда привезёте букет?"), transport());
    expect(r).toEqual({ status: "processed", note: "новое обращение #1" });
    expect(sent).toEqual([
      "📨 Обращение #1 принято. Ответим здесь, в этом чате. Чтобы заказать самостоятельно, напишите номер товара или «каталог».",
    ]);
    expect(notified[0]).toContain("Новое обращение #1");
    expect(notified[0]).toContain("Когда привезёте букет?");
    const rows = db.tables.zernio_logs!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_type: "ticket", status: "open" });
    expect(rows[0]!.payload).toMatchObject({ platform: "whatsapp", telegram_id: -7 });
  });

  it("следующий вопрос дописывается в открытое обращение: без нового номера и без повторного ответа", async () => {
    await handleZernioMessage(ctx(ON), payload("Когда привезёте букет?"), transport());
    const r = await handleZernioMessage(ctx(ON), payload("И можно открытку?"), transport());
    expect(r).toEqual({ status: "processed", note: "дополнение к обращению #1" });
    expect(sent).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(db.tables.zernio_logs).toHaveLength(1);
  });

  it("повторный вопрос через час при открытом обращении — снова с номером, а не общий ответ", async () => {
    await handleZernioMessage(ctx(ON), payload("Когда привезёте букет?"), transport());
    const direct = customer.state.direct as Record<string, unknown>;
    customer = {
      ...customer,
      state: {
        ...customer.state,
        direct: { ...direct, forwarded_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
      },
    };
    const r = await handleZernioMessage(ctx(ON), payload("Вы тут?"), transport());
    expect(r).toEqual({ status: "processed", note: "дополнение к обращению #1" });
    expect(sent[1]).toBe(
      "📨 Добавил к обращению #1. Ответим здесь. Чтобы заказать самостоятельно, напишите номер товара или «каталог».",
    );
    expect(notified).toHaveLength(1);
  });

  it("без модуля «Поддержка» — как раньше: «передал продавцу», обращений нет", async () => {
    const r = await handleZernioMessage(
      ctx({ ...ON, helpdesk: false }),
      payload("Когда привезёте букет?"),
      transport(),
    );
    expect(r).toEqual({ status: "processed", note: "консультант выключен — сообщение в «Чате»" });
    expect(sent[0]).toMatch(/^Передал ваш вопрос продавцу/);
    expect(db.tables.zernio_logs ?? []).toHaveLength(0);
  });
});
