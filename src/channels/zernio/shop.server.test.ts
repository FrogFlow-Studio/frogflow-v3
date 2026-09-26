import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { formatMoney } from "@/core/money/money";
import type { ZernioTransport } from "./api.server";
import type { ParsedZernioMessage } from "./message";
import type { ZernioPlatform } from "./platform";
import { WA_LIST_MAX_ROWS, WA_LIST_PAGE } from "./shop-flow";
import { handleShopMessage } from "./shop.server";

/**
 * Магазин в Direct и WhatsApp целиком, на базе в памяти и подменённом
 * транспорте Zernio: что уходит покупателю и что остаётся в state.
 */

const BOT = "00000000-0000-0000-0000-0000000000dd";

type Sent = { text: string; interactive?: Json };

function setup(
  opts: {
    platform?: ZernioPlatform;
    sendOk?: boolean;
    state?: Record<string, unknown>;
    modules?: Record<string, boolean>;
    loyaltyPoints?: number;
  } = {},
) {
  const db = fakeDb();
  const tables: string[] = [];
  const state = opts.state ?? { locale: "ru" };
  db.tables.bot_users = [{ id: "u1", bot_id: BOT, user_key: "wa_1", state }];
  db.tables.categories = [];
  db.tables.products = [];
  db.tables.cart_items = [];
  db.tables.orders = [];
  const ctx = {
    tenant: { id: BOT, modules: opts.modules ?? {}, settings: {} },
    db: {
      from: (t: string) => {
        tables.push(t);
        return db.from(t);
      },
      // Захват оформления занят: сценарий доходит до placeOrder и останавливается.
      rpc: (name: string, args: Record<string, unknown>) =>
        name === "claim_order_placement"
          ? Promise.resolve({ data: false, error: null })
          : db.rpc(name, args),
    },
    appUrl: "https://app.test",
  } as unknown as TenantContext;
  const customer: Customer = {
    userKey: "wa_1",
    platform: opts.platform ?? "whatsapp",
    telegramId: -1,
    username: null,
    firstName: "Покупатель",
    lastName: null,
    languageCode: null,
    contactPhone: null,
    email: null,
    loyaltyPoints: opts.loyaltyPoints ?? 0,
    state: state as Customer["state"],
    zernioConversationId: "conv-1",
    zernioAccountId: "acc-1",
  };
  const sent: Sent[] = [];
  const download = vi.fn(async () => null);
  const transport: ZernioTransport = {
    send: vi.fn(async (_c: string, _a: string, text: string, o: { interactive?: Json } = {}) => {
      sent.push({ text, interactive: o.interactive });
      return opts.sendOk === false ? { ok: false, error: "Zernio API 403" } : { ok: true };
    }),
    tail: vi.fn(async () => []),
    download,
    mailReady: () => false,
  };
  const msg = (m: Partial<ParsedZernioMessage>): ParsedZernioMessage => ({
    conversationId: "conv-1",
    accountId: "acc-1",
    platform: opts.platform ?? "whatsapp",
    senderId: "1",
    senderUsername: "",
    senderName: "Покупатель",
    senderPhone: "",
    text: "",
    metadata: {},
    postbackPayload: null,
    nativeOrder: null,
    attachments: [],
    mediaWithoutUrl: false,
    storyId: null,
    storyMediaUrl: null,
    outgoing: false,
    ...m,
  });
  const send = (m: Partial<ParsedZernioMessage>) =>
    handleShopMessage(ctx, customer, msg(m), transport);
  const direct = () =>
    ((db.tables.bot_users![0]!.state as Record<string, unknown>).direct ?? {}) as Record<
      string,
      unknown
    >;
  return { db, tables, sent, send, download, transport, direct };
}

/** Строки списка WhatsApp из последнего отправленного сообщения. */
function rows(sent: Sent[]): Array<{ id: string; title: string; description?: string }> {
  const list = sent.at(-1)?.interactive as unknown as {
    action: {
      sections: Array<{ rows: Array<{ id: string; title: string; description?: string }> }>;
    };
  };
  return list.action.sections.flatMap((s) => s.rows);
}

function category(id: string, parent: string | null, sort: number) {
  return {
    id,
    bot_id: BOT,
    name: `Раздел ${id}`,
    parent_id: parent,
    is_visible: true,
    sort_order: sort,
  };
}

describe("ответ покупателю", () => {
  it("отклонённый Zernio ответ не помечается отправленным", async () => {
    const { send, sent, direct } = setup({ sendOk: false });
    await send({ text: "отмена" });
    expect(sent).toHaveLength(1);
    // Иначе защита от повтора подавила бы тот же ответ, так и не дошедший.
    expect(direct().last_reply).toBeUndefined();
    expect(direct().last_reply_at).toBeUndefined();
  });

  it("метка повтора пишется только после успешной отправки", async () => {
    const { send, direct } = setup();
    await send({ text: "отмена" });
    expect(direct().last_reply).toEqual(expect.any(String));
    expect(direct().last_reply_at).toEqual(expect.any(String));
  });
});

describe("шаг «списать баллы?» в Direct/WhatsApp", () => {
  const asking = {
    state: { locale: "ru", mode: "awaiting_points_choice", country_code: "KZ" },
    modules: { loyalty: true },
    loyaltyPoints: 50,
  };
  const saved = (db: ReturnType<typeof setup>["db"]) =>
    db.tables.bot_users![0]!.state as Record<string, unknown>;

  it("«спасибо» — не ответ: шаг переспрашивает с кнопками, баллы не тронуты", async () => {
    const { db, sent, send } = setup(asking);
    await send({ text: "спасибо" });
    expect(sent.at(-1)?.text).toContain("У вас 50 баллов");
    expect(saved(db).mode).toBe("awaiting_points_choice");
    expect(saved(db).use_points).toBeUndefined();
  });

  it("«нет» кнопкой — копить: use_points=false, оформление идёт дальше", async () => {
    const { db, send } = setup(asking);
    await send({ postbackPayload: "LOYALTY:no", text: "Нет, копить" });
    expect(saved(db).use_points).toBe(false);
    expect(saved(db).mode).not.toBe("awaiting_points_choice");
  });

  it("«да» текстом — списать: use_points=true", async () => {
    const { db, send } = setup(asking);
    await send({ text: "да" });
    expect(saved(db).use_points).toBe(true);
  });
});

describe("чек вне платёжного шага", () => {
  it("картинка без открытого заказа за чек не принимается", async () => {
    const { send, sent, download, db } = setup({ platform: "instagram" });
    const r = await send({
      attachments: [{ type: "image", url: "https://cdn.test/receipt.jpg" }],
    });
    expect(r.outcome).toBe("question");
    expect(download).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(db.tables.orders).toHaveLength(0);
  });
});

describe("каталог WhatsApp: постбэк CAT:<раздел>:<смещение>", () => {
  it("пустой раздел в постбэке — это корень: показываются разделы верхнего уровня", async () => {
    const { db, send, sent } = setup();
    db.tables.categories = [category("a", null, 1), category("b", null, 2), category("a1", "a", 1)];
    await send({ postbackPayload: "CAT::0" });
    expect(
      rows(sent)
        .slice(0, 2)
        .map((r) => r.id),
    ).toEqual(["CAT:a:0", "CAT:b:0"]);
    expect(rows(sent).map((r) => r.id)).not.toContain("CAT:a1:0");
  });

  it("раздел и смещение читаются как есть", async () => {
    const { db, send, sent } = setup();
    db.tables.categories = [
      category("a", null, 1),
      ...Array.from({ length: 9 }, (_, i) => category(`c${i}`, "a", i)),
    ];
    await send({ postbackPayload: "CAT:a:7" });
    const ids = rows(sent).map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(["CAT:c7:0", "CAT:c8:0"]);
    expect(ids).not.toContain("CAT:c0:0");
  });

  it("чужие постбэки каталогом не перехватываются", async () => {
    for (const payload of ["CART", "PROD:нет-такого"]) {
      const { send, tables, sent } = setup();
      await send({ postbackPayload: payload });
      expect(tables, payload).not.toContain("categories");
      expect(sent.every((m) => !JSON.stringify(m.interactive ?? null).includes("CAT:"))).toBe(true);
    }
  });

  it("страница оставляет место под «Ещё», «Корзину» и «Назад»", async () => {
    // Вложенный раздел, где содержимого больше страницы: навигация нужна вся
    // сразу и не должна вытеснять разделы — лимит Meta десять строк.
    expect(WA_LIST_PAGE + 3).toBe(WA_LIST_MAX_ROWS);
    const { db, send, sent } = setup();
    db.tables.categories = [
      category("a", null, 1),
      ...Array.from({ length: 12 }, (_, i) => category(`c${String(i).padStart(2, "0")}`, "a", i)),
    ];
    await send({ postbackPayload: "CAT:a:0" });
    const ids = rows(sent).map((r) => r.id);
    expect(ids).toHaveLength(WA_LIST_MAX_ROWS);
    expect(ids.slice(0, WA_LIST_PAGE).every((id) => /^CAT:c\d\d:0$/.test(id))).toBe(true);
    expect(ids.slice(WA_LIST_PAGE)).toEqual([`CAT:a:${WA_LIST_PAGE}`, "CART", "CATALOG"]);
  });
});

describe("каталог WhatsApp: навигация (опись v1: tests/whatsapp-catalog.test.ts)", () => {
  it("«Назад» из категории ведёт к её родителю, а не к ней самой", async () => {
    const { db, send, sent } = setup();
    db.tables.categories = [
      category("a", null, 1),
      category("a1", "a", 1),
      category("a1x", "a1", 1),
    ];
    await send({ postbackPayload: "CAT:a1:0" });
    const ids = rows(sent).map((r) => r.id);
    expect(ids).toContain("CAT:a:0");
    expect(ids).not.toContain("CAT:a1:0");
    // У раздела верхнего уровня родителя нет — «Назад» ведёт в корень.
    await send({ postbackPayload: "CAT:a:0" });
    expect(rows(sent).map((r) => r.id)).toContain("CATALOG");
  });

  it("отсутствующее или битое смещение — это ноль, а не NaN", async () => {
    for (const payload of ["CAT:a", "CAT:a:абв", "CAT:a:-5"]) {
      const { db, send, sent } = setup();
      db.tables.categories = [
        category("a", null, 1),
        category("c0", "a", 1),
        category("c1", "a", 2),
      ];
      await send({ postbackPayload: payload });
      expect(
        rows(sent)
          .map((r) => r.id)
          .slice(0, 2),
        payload,
      ).toEqual(["CAT:c0:0", "CAT:c1:0"]);
    }
  });
});

describe("каталог WhatsApp: описание строки товара", () => {
  it("короткому названию описание — цена, и цена есть у длинного названия", async () => {
    const { db, send, sent } = setup();
    db.tables.products = [
      {
        id: "p1",
        bot_id: BOT,
        name: "Пазлы",
        price: 600,
        currency: "KZT",
        category_ids: "[]",
        is_active: true,
        sort_order: 1,
        product_variants: [],
      },
      {
        id: "p2",
        bot_id: BOT,
        name: "034. Декор на дверь к 1 сентября",
        price: 600,
        currency: "KZT",
        category_ids: "[]",
        is_active: true,
        sort_order: 2,
        product_variants: [],
      },
    ];
    await send({ postbackPayload: "CATALOG" });
    const products = rows(sent).filter((r) => r.id.startsWith("PROD:"));
    expect(products.map((r) => r.description)).toEqual([
      formatMoney(600, "KZT"),
      formatMoney(600, "KZT"),
    ]);
  });
});

describe("кнопка «Купить» автоматизации Instagram (опись v1: tests/whatsapp-activation.test.ts)", () => {
  it("restarts Instagram on /start so a CMD «Купить» button wakes the shop", async () => {
    const { db, send, tables, sent } = setup({ platform: "instagram" });
    db.tables.categories = [category("a", null, 1)];
    const r = await send({ text: "Купить", postbackPayload: "/start" });
    expect(r.outcome).toBe("handled");
    expect(tables).toContain("categories");
    expect(sent.at(-1)?.text).toContain("Раздел a");
  });

  it("ignores native Zernio ACT:: buttons and ordinary chat", async () => {
    const { send, tables } = setup({ platform: "instagram" });
    const r = await send({
      text: "Я подписался",
      postbackPayload: "ACT::cc82e5ebd3b465e3243fde66982ba8d0",
    });
    expect(r.outcome).toBe("question");
    expect(tables).not.toContain("categories");
  });
});
