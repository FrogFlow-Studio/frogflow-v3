import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

/**
 * «Пробный заказ»: настоящий расчёт цены и настоящие проверки на базе в памяти.
 * Подменён только Telegram (отправка) — считаем, сколько раз она вызвана.
 */
const BOT = "b41a34cb-7944-441b-8f71-503184fc0f1f";
const state = vi.hoisted(() => ({ sent: [] as string[], sendThrows: false }));
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: async (_ctx: unknown, html: string) => {
    if (state.sendThrows) throw new Error("обрыв");
    state.sent.push(html);
    return 1;
  },
}));

const { runTrialOrder, loadFirstWeek, TRIAL_DONE_KEY, TRIAL_STAMP_KEY } =
  await import("./onboarding.server");
const { withBrokenReads } = await import("../../../tests/broken-db");

let db: FakeDb;
const NOW = Date.parse("2026-10-05T10:00:00Z");
function ctx(
  over: {
    token?: boolean;
    owner?: number | null;
    robokassa?: boolean;
    vertical?: string;
    modules?: Record<string, boolean>;
  } = {},
) {
  return {
    tenant: {
      id: BOT,
      vertical: over.vertical ?? "digital",
      telegramTokenEnc: over.token === false ? null : "enc:x",
      ownerTelegramId: over.owner === undefined ? 500000221 : over.owner,
      modules: { robokassa: over.robokassa ?? false, ...over.modules },
      settings: { default_locale: "ru", telegram: { username: "shop_bot" } },
    },
    timezone: "Asia/Almaty",
    db,
  } as never;
}
const product = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  bot_id: BOT,
  name: "Набор открыток",
  description: "",
  keywords: "",
  price: 1500,
  currency: "KZT",
  country_prices: {},
  is_active: true,
  category_ids: [],
  fulfillment_kind: "digital",
  stock_quantity: null,
  lead_time_days: null,
  file_path: `${BOT}/aaaaaaaaaaaaaaaaaaaaaaaa.pdf`,
  file_name: "set.pdf",
  file_url: null,
  file_path_kz: null,
  file_name_kz: null,
  file_url_kz: null,
  rating_avg: null,
  rating_count: 0,
  sort_order: 0,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});
const pay = {
  id: "pm1",
  bot_id: BOT,
  country_code: "KZ",
  country_name: "Казахстан",
  currency: "KZT",
  instructions: "Kaspi",
  qr_code_path: null,
  sort_order: 0,
};
const setting = (key: string) =>
  (db.tables.app_settings ?? []).find((r) => r.key === key)?.value as string | undefined;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.products = [product()];
  db.tables.payment_methods = [pay];
  state.sent = [];
  state.sendThrows = false;
});

describe("пробный заказ", () => {
  it("всё на месте: прошёл, сумма посчитана, пробное уведомление ушло, заказов нет", async () => {
    const r = await runTrialOrder(ctx(), null, NOW);
    expect(r).toMatchObject({ ok: true, total: 1500, dueNow: 1500, issues: [], notified: "sent" });
    expect(r.product?.name).toBe("Набор открыток");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toContain("Пробный заказ");
    // ничего не создано: ни заказа, ни позиций, ни платежа
    expect(db.tables.orders ?? []).toHaveLength(0);
    expect(db.tables.order_items ?? []).toHaveLength(0);
    // прошёл — отметка для чек-листа
    expect(setting(TRIAL_DONE_KEY)).toBe(new Date(NOW).toISOString());
  });

  it("нет способа оплаты и файла: не прошёл, отметки «прошёл» нет, причины названы", async () => {
    db.tables.payment_methods = [];
    db.tables.products = [product({ file_path: null, file_name: null })];
    const r = await runTrialOrder(ctx(), null, NOW);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(expect.arrayContaining(["payment", "file"]));
    expect(setting(TRIAL_DONE_KEY)).toBeUndefined();
  });

  it("робокасса вместо способов оплаты — оплата есть", async () => {
    db.tables.payment_methods = [];
    const r = await runTrialOrder(ctx({ robokassa: true }), null, NOW);
    expect(r.issues).not.toContain("payment");
  });

  it("нет товаров — понятный ответ, а не ошибка", async () => {
    db.tables.products = [];
    expect(await runTrialOrder(ctx(), null, NOW)).toMatchObject({ ok: false, noProduct: true });
    expect(state.sent).toHaveLength(0);
  });

  it("повторный запуск в течение минуты не шлёт второе уведомление", async () => {
    await runTrialOrder(ctx(), null, NOW);
    const again = await runTrialOrder(ctx(), null, NOW + 20_000);
    expect(again.notified).toBe("recent");
    expect(state.sent).toHaveLength(1);
    const later = await runTrialOrder(ctx(), null, NOW + 70_000);
    expect(later.notified).toBe("sent");
    expect(state.sent).toHaveLength(2);
  });

  it("два одновременных запуска шлют одно уведомление", async () => {
    const [a, b] = await Promise.all([
      runTrialOrder(ctx(), null, NOW),
      runTrialOrder(ctx(), null, NOW),
    ]);
    expect([a.notified, b.notified].sort()).toEqual(["recent", "sent"]);
    expect(state.sent).toHaveLength(1);
  });

  it("отправка оборвалась: «не удалось», сама проверка прошла, второй раз не шлём", async () => {
    state.sendThrows = true;
    const r = await runTrialOrder(ctx(), null, NOW);
    expect(r.notified).toBe("failed");
    expect(r.ok).toBe(true);
    state.sendThrows = false;
    const again = await runTrialOrder(ctx(), null, NOW + 5_000);
    expect(again.notified).toBe("recent");
    expect(state.sent).toHaveLength(0);
    expect(setting(TRIAL_STAMP_KEY)).toBeTruthy();
  });

  it("нет получателя: предупреждение notify, но проверка прошла, уведомление не слали", async () => {
    const r = await runTrialOrder(ctx({ owner: null }), null, NOW);
    expect(r.issues).toEqual(["notify"]);
    expect(r.ok).toBe(true);
    expect(r.notified).toBe("none");
    expect(state.sent).toHaveLength(0);
  });
});

describe("первые 7 дней: факты из базы", () => {
  const empty = () => {
    db.tables.products = [];
    db.tables.payment_methods = [];
    db.tables.bot_users = [];
    db.tables.orders = [];
    db.tables.app_settings = [];
  };
  const steps = async (c = ctx()) =>
    (await loadFirstWeek(c)).rows.filter((r) => r.done).map((r) => r.step);

  it("пустой магазин: ни одного пункта", async () => {
    empty();
    expect(await steps()).toEqual([]);
  });

  it("товар закрывается только включённым", async () => {
    empty();
    db.tables.products = [product({ is_active: false })];
    expect(await steps()).toEqual([]);
    db.tables.products = [product({ is_active: true })];
    expect(await steps()).toEqual(["product"]);
  });

  it("оплата: способ оплаты или робокасса", async () => {
    empty();
    db.tables.payment_methods = [pay];
    expect(await steps()).toEqual(["payment"]);
    empty();
    expect(await steps(ctx({ robokassa: true }))).toEqual(["payment"]);
  });

  it("ссылка: сам продавец покупателем не считается, другой человек — считается", async () => {
    empty();
    db.tables.bot_users = [
      { user_key: "tg:500000221", bot_id: BOT, telegram_id: 500000221, state: {} },
    ];
    expect(await steps()).toEqual([]);
    db.tables.bot_users.push({ user_key: "tg:700", bot_id: BOT, telegram_id: 700, state: {} });
    expect(await steps()).toEqual(["link"]);
  });

  it("пробный заказ: закрывается отметкой «прошёл», а не нажатием кнопки", async () => {
    empty();
    db.tables.payment_methods = [pay];
    // кнопку нажали, но проверка не прошла (нет файла) — отметки нет, пункт не закрыт
    db.tables.products = [product({ file_path: null, file_name: null })];
    await runTrialOrder(ctx(), null, NOW);
    expect(await steps()).not.toContain("trial");
    db.tables.products = [product()];
    await runTrialOrder(ctx(), null, NOW + 120_000);
    expect(await steps()).toContain("trial");
  });

  it("оплаченный заказ закрывает всё, неоплаченный — ничего", async () => {
    empty();
    db.tables.orders = [{ id: 1, bot_id: BOT, status: "pending", paid_amount: 0, total: 1500 }];
    expect(await steps()).toEqual([]);
    db.tables.orders = [{ id: 2, bot_id: BOT, status: "paid", paid_amount: 1500, total: 1500 }];
    const s = await loadFirstWeek(ctx());
    expect(s).toMatchObject({ percent: 100, visible: false, sold: true });
  });

  it("консультант с модулем магазина из v1 без товаров (BOVI) — карточки нет; с товаром — есть", async () => {
    empty();
    const bovi = ctx({ vertical: "consultant", modules: { shop: true, dm_shop: true } });
    expect((await loadFirstWeek(bovi)).visible).toBe(false);
    db.tables.products = [product({ is_active: false })];
    expect((await loadFirstWeek(bovi)).visible).toBe(false);
    db.tables.products = [product({ is_active: true })];
    expect((await loadFirstWeek(bovi)).visible).toBe(true);
    // Магазин без товаров — карточка, как раньше.
    empty();
    expect((await loadFirstWeek(ctx())).visible).toBe(true);
  });

  it("не прочиталось — ошибка, а не «ничего не сделано»", async () => {
    empty();
    const broken = { ...(ctx() as object), db: withBrokenReads(db, ["products"]) } as never;
    await expect(loadFirstWeek(broken)).rejects.toThrow();
  });
});
