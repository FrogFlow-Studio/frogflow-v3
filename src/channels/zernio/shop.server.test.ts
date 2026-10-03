import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Customer } from "@/core/customers/customers";
import type { Json } from "@/core/db-types";
import { formatMoney } from "@/core/money/money";
import { imageUrl } from "@/core/catalog/catalog";
import type { ZernioTransport } from "./api.server";
import type { ParsedZernioMessage } from "./message";
import type { ZernioPlatform } from "./platform";
import { WA_LIST_MAX_ROWS, WA_LIST_PAGE } from "./shop-flow";
import { handleShopMessage } from "./shop.server";
import { COPY } from "@/channels/telegram/copy";
import { contactRequested } from "@/core/instagram/ice-breakers";

/**
 * Магазин в Direct и WhatsApp целиком, на базе в памяти и подменённом
 * транспорте Zernio: что уходит покупателю и что остаётся в state.
 */

const BOT = "00000000-0000-0000-0000-0000000000dd";

// Хранилище чеков: загрузка всегда удаётся (attachPaymentProof в тестах чека).
vi.mock("@/core/db/client.server", () => ({
  serviceDb: () => ({
    storage: {
      from: () => ({
        upload: async () => ({ data: {}, error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }),
}));

// Поиск по коду в базе в памяти не работает (нет .or): ни один код не найден.
vi.mock("@/core/catalog/catalog", async (orig) => ({
  ...(await orig<typeof import("@/core/catalog/catalog")>()),
  searchProducts: async () => [],
}));

// ИИ-консультант: «Связаться с продавцом» ставит его на паузу, если включён.
const consultant = vi.hoisted(() => ({ enabled: false, paused: 0 }));
vi.mock("@/core/consultant/engine.server", () => ({
  consultantEnabled: async () => consultant.enabled,
  pauseConsultant: async (_ctx: unknown, c: unknown) => {
    consultant.paused++;
    return c;
  },
}));

type Sent = { text: string; interactive?: Json; buttons?: unknown[] };

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
    send: vi.fn(
      async (
        _c: string,
        _a: string,
        text: string,
        o: { interactive?: Json; buttons?: unknown[] } = {},
      ) => {
        sent.push({ text, interactive: o.interactive, buttons: o.buttons });
        return opts.sendOk === false ? { ok: false, error: "Zernio API 403" } : { ok: true };
      },
    ),
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
    platformMessageId: null,
    attachments: [],
    mediaWithoutUrl: false,
    storyId: null,
    storyMediaUrl: null,
    outgoing: false,
    ...m,
  });
  // Следующее сообщение видит состояние после предыдущего, как в handle-message.
  let current = customer;
  const send = async (m: Partial<ParsedZernioMessage>) => {
    const r = await handleShopMessage(ctx, current, msg(m), transport);
    current = r.customer;
    return r;
  };
  const direct = () =>
    ((db.tables.bot_users![0]!.state as Record<string, unknown>).direct ?? {}) as Record<
      string,
      unknown
    >;
  return { db, tables, sent, send, download, transport, direct, ctx };
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
  // «отмена» — в живом разговоре с ботом (строгий режим молчит вне его).
  const talking = { locale: "ru", mode: "awaiting_contact" };

  it("отклонённый Zernio ответ не помечается отправленным", async () => {
    const { send, sent, direct } = setup({ sendOk: false, state: talking });
    await send({ text: "отмена" });
    expect(sent).toHaveLength(1);
    // Иначе защита от повтора подавила бы тот же ответ, так и не дошедший.
    expect(direct().last_reply).toBeUndefined();
    expect(direct().last_reply_at).toBeUndefined();
  });

  it("метка повтора пишется только после успешной отправки", async () => {
    const { send, direct } = setup({ state: talking });
    await send({ text: "отмена" });
    expect(direct().last_reply).toEqual(expect.any(String));
    expect(direct().last_reply_at).toEqual(expect.any(String));
  });
});

describe("шаг «списать баллы?» в Direct/WhatsApp", () => {
  const asking = {
    state: {
      locale: "ru",
      mode: "awaiting_points_choice",
      country_code: "KZ",
      // Бот только что спросил: нераспознанный ответ получает подсказку.
      direct: { last_reply_at: new Date().toISOString() },
    },
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
      attachments: [{ type: "image", url: "https://cdn.test/receipt.jpg", index: 0 }],
    });
    expect(r.outcome).toBe("question");
    expect(download).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(db.tables.orders).toHaveLength(0);
  });
});

describe("чек из Instagram: просроченная ссылка CDN", () => {
  const waiting = { locale: "ru", mode: "awaiting_proof", pending_order_id: 7 };
  const receipt = {
    platformMessageId: "mid-1",
    attachments: [
      { type: "audio", url: "https://cdn.test/voice.mp4", index: 0 },
      { type: "image", url: "https://cdn.test/old.jpg", index: 1 },
    ],
  };

  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const awaitingOrder = () => ({
    id: 7,
    bot_id: BOT,
    order_no: 7,
    display_no: 107,
    telegram_id: -1,
    status: "awaiting_payment",
    fulfillment_kind: "digital",
    total: 1000,
    currency: "KZT",
    payment_proof_path: null,
    payment_proof_hash: null,
    order_items: [],
  });

  it("старая ссылка мертва, свежая скачалась — чек принят, заказ ждёт подтверждения", async () => {
    const { send, download, transport, db, sent } = setup({
      platform: "instagram",
      state: waiting,
    });
    db.tables.orders = [awaitingOrder()];
    db.tables.order_items = [];
    download.mockImplementation((async (url: string) =>
      url === "https://cdn.test/fresh.jpg"
        ? { bytes: JPEG, mime: "image/jpeg" }
        : null) as unknown as () => Promise<null>);
    const refresh = vi.fn(async () => "https://cdn.test/fresh.jpg");
    transport.refresh = refresh;
    await send(receipt);
    expect(refresh).toHaveBeenCalledWith("conv-1", "mid-1", 1, "acc-1");
    expect(download.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      "https://cdn.test/old.jpg",
      "https://cdn.test/fresh.jpg",
    ]);
    expect(db.tables.orders![0]).toMatchObject({ status: "awaiting_confirmation" });
    expect(db.tables.orders![0]!.payment_proof_path).toContain("order-7");
    expect(sent.at(-1)?.text).toMatch(/получен/);
  });

  it("свежая ссылка тоже не скачалась — две попытки, просим прислать чек заново", async () => {
    const { send, download, transport, db, sent } = setup({
      platform: "instagram",
      state: waiting,
    });
    db.tables.orders = [awaitingOrder()];
    transport.refresh = vi.fn(async () => "https://cdn.test/fresh.jpg");
    await send(receipt);
    expect(download).toHaveBeenCalledTimes(2);
    expect(db.tables.orders![0]).toMatchObject({ status: "awaiting_payment" });
    expect(sent.at(-1)?.text).toMatch(/Не удалось сохранить чек/);
  });

  it("перечитать не вышло — просим прислать чек заново, повторно не качаем", async () => {
    const { send, download, transport, sent } = setup({ platform: "instagram", state: waiting });
    transport.refresh = vi.fn(async () => null);
    await send(receipt);
    expect(download).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)?.text).toMatch(/чек/i);
  });

  it("без id сообщения у Meta перечитывать нечем — сразу просим чек заново", async () => {
    const { send, download, transport } = setup({ platform: "instagram", state: waiting });
    const refresh = vi.fn(async () => "https://cdn.test/fresh.jpg");
    transport.refresh = refresh;
    await send({ ...receipt, platformMessageId: null });
    expect(refresh).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(1);
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
    const byTitle = Object.fromEntries(products.map((r) => [r.title, r.description]));
    expect(byTitle).toEqual({
      Пазлы: formatMoney(600, "KZT"),
      "034. Декор на дверь к 1…": `сентября · ${formatMoney(600, "KZT")}`,
    });
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

describe("фото товара в Instagram и WhatsApp", () => {
  const product = (images: string[]) => ({
    id: "p1",
    bot_id: BOT,
    name: "Пазлы",
    price: 600,
    currency: "KZT",
    category_ids: "[]",
    is_active: true,
    sort_order: 1,
    product_variants: [],
    product_images: images.map((image_path, i) => ({ id: `i${i}`, image_path, sort_order: i })),
  });
  const MB = 1024 * 1024;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("WebP и тяжёлое фото пропускаются — уходит первое подходящее", async () => {
    const { db, send, transport, ctx } = setup({ platform: "whatsapp" });
    db.tables.products = [product(["a.webp", "big.jpg", "ok.png"])];
    const info: Record<string, { size: number; contentType: string; head: Uint8Array }> = {
      "a.webp": { size: MB, contentType: "image/webp", head: JPEG },
      "big.jpg": { size: 6 * MB, contentType: "image/jpeg", head: JPEG },
      "ok.png": { size: MB, contentType: "image/png", head: PNG },
    };
    transport.imageInfo = async (_ctx, path) => info[path] ?? null;
    const urls: Array<string | undefined> = [];
    transport.send = vi.fn(async (_c: string, _a: string, _t: string, o = {}) => {
      urls.push((o as { attachmentUrl?: string }).attachmentUrl);
      return { ok: true };
    });
    await send({ postbackPayload: "PROD:p1" });
    expect(urls.at(-1)).toBe(imageUrl(ctx, "ok.png"));
  });

  it("в Instagram то же фото 6 МБ проходит (лимит 8 МБ)", async () => {
    const { db, send, transport, ctx } = setup({ platform: "instagram" });
    db.tables.products = [product(["big.jpg"])];
    transport.imageInfo = async () => ({ size: 6 * MB, contentType: "image/jpeg", head: JPEG });
    const urls: Array<string | undefined> = [];
    transport.send = vi.fn(async (_c: string, _a: string, _t: string, o = {}) => {
      urls.push((o as { attachmentUrl?: string }).attachmentUrl);
      return { ok: true };
    });
    await send({ postbackPayload: "PROD:p1" });
    expect(urls.at(-1)).toBe(imageUrl(ctx, "big.jpg"));
  });

  it("фото не приняли — карточка уходит текстом без фото", async () => {
    const { db, send, transport } = setup({ platform: "instagram" });
    db.tables.products = [product(["a.jpg"])];
    transport.imageInfo = async () => ({ size: MB, contentType: "image/jpeg", head: JPEG });
    const calls: Array<{ text: string; url?: string }> = [];
    transport.send = vi.fn(async (_c: string, _a: string, text: string, o = {}) => {
      const url = (o as { attachmentUrl?: string }).attachmentUrl;
      calls.push({ text, url });
      return url
        ? {
            ok: false,
            error: "Не удалось отправить",
            failure: { status: 400, code: "PLATFORM_LIMITATION" },
          }
        : { ok: true };
    });
    await send({ postbackPayload: "PROD:p1" });
    expect(calls.map((c) => Boolean(c.url))).toEqual([true, false]);
    expect(calls[1]!.text).toBe(calls[0]!.text);
    expect(calls[1]!.text).toContain("Пазлы");
  });

  it("отказ не из-за фото (окно 24 часа, доступ) — без фото не повторяем", async () => {
    const { db, send, transport } = setup({ platform: "whatsapp" });
    db.tables.products = [product(["a.jpg"])];
    transport.imageInfo = async () => ({ size: MB, contentType: "image/jpeg", head: JPEG });
    const calls: Array<string | undefined> = [];
    transport.send = vi.fn(async (_c: string, _a: string, _t: string, o = {}) => {
      calls.push((o as { attachmentUrl?: string }).attachmentUrl);
      return {
        ok: false,
        error: "Прошло больше 24 часов",
        failure: { status: 400, platformCode: 131047 },
      };
    });
    await send({ postbackPayload: "PROD:p1" });
    expect(calls).toHaveLength(1);
  });
});

describe("быстрые вопросы Instagram: постбэк IB:<вид>", () => {
  it("«Мои заказы» — список заказов, «Каталог» — каталог", async () => {
    const { send, sent, tables } = setup({ platform: "instagram" });
    expect((await send({ postbackPayload: "IB:orders", text: "Мои заказы" })).outcome).toBe(
      "handled",
    );
    expect(sent.at(-1)!.text).toContain(COPY.ru.myOrdersEmpty);
    expect((await send({ postbackPayload: "IB:catalog" })).outcome).toBe("handled");
    expect(tables).toContain("categories");
  });

  it("«Связаться с продавцом» — просьба описать вопрос и отметка, что следующий текст — продавцу", async () => {
    const { send, sent, db } = setup({ platform: "instagram" });
    expect((await send({ postbackPayload: "IB:contact" })).outcome).toBe("handled");
    expect(sent.at(-1)!.text).toBe(COPY.ru.ticketPrompt);
    const direct = (
      db.tables.bot_users![0]!.state as { direct?: { contact_requested_at?: string } }
    ).direct;
    expect(contactRequested({ direct })).toBe(true);
    // Сам клик консультанта не ставит на паузу: пауза — когда вопрос ушёл продавцу.
    expect(consultant.paused).toBe(0);
  });

  it("«Как оплатить» с пустой корзиной — способы оплаты и кнопка каталога", async () => {
    const { send, sent, db } = setup({ platform: "instagram" });
    db.tables.payment_methods = [
      { id: "pm1", is_active: true, sort_order: 1, country_name: "Казахстан", currency: "KZT" },
      { id: "pm2", is_active: false, sort_order: 2, country_name: "Россия", currency: "RUB" },
    ];
    expect((await send({ postbackPayload: "IB:pay" })).outcome).toBe("handled");
    expect(sent.at(-1)!.text).toBe(COPY.ru.payMethods("• Казахстан (KZT)"));
    expect(sent.at(-1)!.buttons).toHaveLength(1);
  });

  it("«Как оплатить» без способов оплаты — честно говорим, что оплата не настроена", async () => {
    const { send, sent, db } = setup({ platform: "instagram" });
    db.tables.payment_methods = [];
    await send({ postbackPayload: "IB:pay" });
    expect(sent.at(-1)!.text).toBe(COPY.ru.paymentNotConfigured);
  });

  it("новому покупателю — сразу ответ по делу, без выбора языка", async () => {
    const { send, sent, db } = setup({ platform: "instagram", state: {} });
    db.tables.payment_methods = [];
    await send({ postbackPayload: "IB:pay" });
    expect((db.tables.bot_users![0]!.state as { mode?: string }).mode).not.toBe("awaiting_locale");
    expect(sent.at(-1)!.text).toBe(COPY.ru.paymentNotConfigured);
  });

  it("незнакомый вид подсказки — не наш постбэк", async () => {
    const { send, sent } = setup({ platform: "instagram" });
    expect((await send({ postbackPayload: "IB:other" })).outcome).toBe("question");
    expect(sent).toEqual([]);
  });
});

describe("бот просыпается только по делу (Educational Bot, 29.09)", () => {
  const methods = [
    {
      id: "pm1",
      bot_id: BOT,
      is_active: true,
      sort_order: 1,
      country_code: "KZ",
      country_name: "Казахстан",
      currency: "KZT",
    },
    {
      id: "pm2",
      bot_id: BOT,
      is_active: true,
      sort_order: 2,
      country_code: "RU",
      country_name: "Россия",
      currency: "RUB",
    },
  ];
  const item = (id: string, name: string, sort: number) => ({
    id,
    bot_id: BOT,
    name,
    price: 500,
    currency: "KZT",
    category_ids: "[]",
    is_active: true,
    sort_order: sort,
    product_variants: [],
    file_path: `${BOT}/${id}.pdf`,
  });

  it("новый покупатель пишет «Россия» продавцу — бот молчит, язык не спрашивает", async () => {
    const { send, sent, db } = setup({ platform: "instagram", state: {} });
    db.tables.payment_methods = methods;
    const r = await send({ text: "Россия" });
    expect(r.outcome).toBe("question");
    expect(sent).toEqual([]);
    expect((db.tables.bot_users![0]!.state as { mode?: string }).mode).toBeUndefined();
  });

  it("шаг, заданный давно, реплику не забирает", async () => {
    const old = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { send, sent, db } = setup({
      platform: "instagram",
      state: { mode: "awaiting_locale", direct: { last_reply_at: old } },
    });
    db.tables.payment_methods = methods;
    const r = await send({ text: "Россия" });
    expect(r.outcome).toBe("question");
    expect(sent).toEqual([]);
    expect((db.tables.bot_users![0]!.state as { mode?: string }).mode).toBe("idle");
  });

  it("«каталог»: сначала страна, после ответа — каталог", async () => {
    const { send, sent, db } = setup({ platform: "instagram", state: {} });
    db.tables.payment_methods = methods;
    db.tables.products = [item("p1", "130. Сердечки", 1)];
    await send({ text: "каталог" });
    expect(sent.at(-1)!.text).toContain("2. Россия");
    await send({ text: "Россия" });
    const st = db.tables.bot_users![0]!.state as { country_code?: string; mode?: string };
    expect(st.country_code).toBe("RU");
    expect(st.mode).toBe("idle");
    expect(sent.at(-1)!.text).toContain("130. Сердечки");
  });

  it("одна страна оплаты — не спрашиваем, ставим её сами", async () => {
    const { send, sent, db } = setup({ platform: "instagram", state: {} });
    db.tables.payment_methods = [methods[0]!];
    db.tables.products = [item("p1", "130. Сердечки", 1)];
    await send({ text: "каталог" });
    expect((db.tables.bot_users![0]!.state as { country_code?: string }).country_code).toBe("KZ");
    expect(sent.at(-1)!.text).toContain("130. Сердечки");
  });

  it("«2 4» в ответ на список товаров — оба в корзине", async () => {
    const { send, sent, db } = setup({
      platform: "instagram",
      state: { locale: "ru", country_code: "KZ" },
    });
    db.tables.payment_methods = methods;
    db.tables.products = [
      item("p1", "130. Сердечки", 1),
      item("p2", "134. Оформление", 2),
      item("p3", "446. Обертка", 3),
    ];
    await send({ text: "каталог" });
    await send({ text: "1, 3" });
    const cart = db.tables.cart_items!.map((c) => c.product_id).sort();
    expect(cart).toEqual(["p1", "p3"]);
    expect(sent.at(-1)!.text).toContain(COPY.ru.cartHeader.replace(/<[^>]+>/g, ""));
  });
});

describe("строгий режим «Только по заказам» (Educational Bot, 03.10)", () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const state = (mode: string, minutesAgo: number, extra: Record<string, unknown> = {}) => ({
    locale: "ru",
    mode,
    country_code: "RU",
    direct: { last_reply_at: ago(minutesAgo), ...extra },
  });

  it("шаг почты: «Страна Россия» через час после вопроса — тишина, шаг ждёт почту", async () => {
    const { send, sent, db } = setup({ platform: "instagram", state: state("awaiting_email", 60) });
    expect((await send({ text: "Страна Россия" })).outcome).toBe("question");
    expect(sent).toEqual([]);
    expect((db.tables.bot_users![0]!.state as { mode?: string }).mode).toBe("awaiting_email");
  });

  it("сразу после вопроса — одна подсказка, вторая реплика — тишина", async () => {
    const { send, sent } = setup({ platform: "instagram", state: state("awaiting_email", 1) });
    await send({ text: "Страна Россия" });
    expect(sent).toHaveLength(1);
    await send({ text: "2" });
    expect(sent).toHaveLength(1);
  });

  it("номер, которого нет в каталоге, вне разговора с ботом — тишина", async () => {
    const { send, sent } = setup({ platform: "instagram", state: { locale: "ru" } });
    expect((await send({ text: "2" })).outcome).toBe("question");
    expect(sent).toEqual([]);
  });

  it("«оплата», «страна», «отмена» в обычной переписке бота не будят; «старт» — будит", async () => {
    const { send, sent, db } = setup({
      platform: "instagram",
      state: { locale: "ru", country_code: "KZ" },
    });
    db.tables.payment_methods = [];
    for (const text of ["оплата", "страна", "отмена"])
      expect((await send({ text })).outcome).toBe("question");
    expect(sent).toEqual([]);
    expect((await send({ text: "старт" })).outcome).toBe("handled");
    expect(sent.length).toBeGreaterThan(0);
  });

  it("ждём чек: «спасибо» через час — без напоминания про чек", async () => {
    const { send, sent } = setup({
      platform: "instagram",
      state: state("awaiting_payment", 60, {}),
    });
    expect((await send({ text: "спасибо" })).outcome).toBe("question");
    expect(sent).toEqual([]);
  });
});
