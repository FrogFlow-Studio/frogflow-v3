import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  SIMILAR_CURSOR_KEY,
  SIMILAR_DEFERRED_KEY,
  SIMILAR_KEY,
  parseSimilar,
  pickSimilar,
  runSimilar,
  similarText,
  type CatalogItem,
  type SimilarSender,
} from "./similar";

const DAY = 86_400_000;
// 11:00 в Алматы.
const NOW = new Date("2026-09-27T06:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString();

const A = "a0000000-0000-4000-8000-000000000001";
const A2 = "a0000000-0000-4000-8000-000000000002";
const A3 = "a0000000-0000-4000-8000-000000000003";
const A4 = "a0000000-0000-4000-8000-000000000004";
const A5 = "a0000000-0000-4000-8000-000000000005";
const B = "b0000000-0000-4000-8000-000000000001";
const CAT_A = "c0000000-0000-4000-8000-00000000000a";
const CAT_B = "c0000000-0000-4000-8000-00000000000b";

const item = (
  id: string,
  cat: string,
  sort = 0,
  extra: Partial<CatalogItem & { is_active: boolean }> = {},
) => ({
  id,
  name: id.slice(0, 2) + sort,
  category_id: null,
  category_ids: [cat],
  sort_order: sort,
  stock_quantity: null,
  is_active: true,
  ...extra,
});

function setup(modules: Record<string, boolean> = { winback: true }) {
  // PK app_settings — (bot_id, key), как в базе.
  const db = fakeDb({ unique: { app_settings: [["key"]] } });
  db.tables.app_settings = [
    {
      key: SIMILAR_KEY,
      value: JSON.stringify({ enabled: true, days: 7, text: "{name}, смотрите:" }),
    },
  ];
  db.tables.products = [
    item(A, CAT_A, 1),
    item(A2, CAT_A, 2),
    item(A3, CAT_A, 3),
    item(A4, CAT_A, 4),
    item(A5, CAT_A, 5, { is_active: false }),
    item(B, CAT_B, 1),
  ];
  db.tables.categories = [
    { id: CAT_A, parent_id: null, is_visible: true },
    { id: CAT_B, parent_id: null, is_visible: true },
  ];
  db.tables.bot_users = [
    { telegram_id: 1, platform: "telegram", first_name: "Аня", opt_out: false, state: {} },
    { telegram_id: 2, platform: "telegram", first_name: "Отписался", opt_out: true, state: {} },
    { telegram_id: 3, platform: "telegram", first_name: "Блок", opt_out: false, state: {} },
    { telegram_id: 4, platform: "telegram", first_name: "Рано", opt_out: false, state: {} },
  ];
  db.tables.blocked_users = [{ telegram_id: 3 }];
  db.tables.orders = [
    { id: 10, telegram_id: 1, platform: "telegram", status: "delivered", created_at: ago(8) },
    { id: 11, telegram_id: 2, platform: "telegram", status: "delivered", created_at: ago(8) },
    { id: 12, telegram_id: 3, platform: "telegram", status: "delivered", created_at: ago(8) },
    // Срок ещё не настал.
    { id: 13, telegram_id: 4, platform: "telegram", status: "delivered", created_at: ago(2) },
  ];
  db.tables.order_items = [
    { order_id: 10, product_id: A },
    { order_id: 11, product_id: A },
    { order_id: 12, product_id: A },
    { order_id: 13, product_id: A },
  ];
  const ctx = {
    tenant: { id: "bot", modules, settings: {} },
    timezone: "Asia/Almaty",
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

function collect() {
  const sent: Array<{ to: number; text: string; ids: string[] }> = [];
  const send: SimilarSender = async (to, text, products) => {
    sent.push({ to: to.telegramId, text, ids: products.map((p) => p.id) });
    return true;
  };
  return { sent, send };
}

describe("похожие материалы: выбор товаров", () => {
  it("из тех же категорий, без купленного и без закончившихся, по порядку, не больше трёх", () => {
    const catalog = [
      item(A, CAT_A, 1),
      item(A2, CAT_A, 2, { stock_quantity: 0 }),
      item(A3, CAT_A, 3),
      item(A4, CAT_A, 4),
      item(A5, CAT_A, 5),
      item(B, CAT_B, 0),
    ] as CatalogItem[];
    expect(
      pickSimilar(catalog, [A], new Set([A]), new Set([CAT_A, CAT_B])).map((p) => p.id),
    ).toEqual([A3, A4, A5]);
    expect(pickSimilar(catalog, ["нет такого"], new Set(), new Set([CAT_A]))).toEqual([]);
  });

  it("скрытый раздел не предлагаем, даже если покупка из него", () => {
    const catalog = [
      item(A, CAT_A, 1),
      item(A2, CAT_A, 2),
      // Лежит и в скрытой, и в видимой категории — предлагаем по видимой.
      { ...item(A3, CAT_A, 3), category_ids: [CAT_A, CAT_B] },
      item(B, CAT_B, 4),
    ] as CatalogItem[];
    expect(pickSimilar(catalog, [A], new Set([A]), new Set([CAT_B]))).toEqual([]);
    const both = { ...item(A, CAT_A, 1), category_ids: [CAT_A, CAT_B] } as CatalogItem;
    expect(
      pickSimilar([both, ...catalog.slice(1)], [A], new Set([A]), new Set([CAT_B])).map(
        (p) => p.id,
      ),
    ).toEqual([A3, B]);
  });

  it("настройки: мусорные дни — по умолчанию; имя подставляется", () => {
    expect(parseSimilar(JSON.stringify({ enabled: true, days: 0 })).days).toBe(7);
    expect(parseSimilar("не json").enabled).toBe(false);
    expect(similarText(parseSimilar(null), null)).toMatch(/^Здравствуйте,/);
  });
});

describe("похожие материалы: крон", () => {
  it("пишет только тому, кому срок настал, не отписавшимся и не заблокированным", async () => {
    const { db, ctx } = setup();
    const { sent, send } = collect();
    const r = await runSimilar(ctx, send, NOW);
    expect(sent).toEqual([{ to: 1, text: "Аня, смотрите:", ids: [A2, A3, A4] }]);
    expect(r).toMatchObject({ sent: 1 });
    // Курсор встал на последний разобранный заказ, не на ранний 13-й.
    expect(db.tables.app_settings!.find((s) => s.key === SIMILAR_CURSOR_KEY)!.value).toBe("12");
  });

  it("один раз на заказ: второй проход ничего не шлёт, а новый заказ в срок — шлёт", async () => {
    const { db, ctx } = setup();
    await runSimilar(ctx, collect().send, NOW);
    const again = collect();
    await runSimilar(ctx, again.send, NOW);
    expect(again.sent).toEqual([]);
    const later = collect();
    await runSimilar(ctx, later.send, new Date(NOW.getTime() + 6 * DAY));
    expect(later.sent.map((s) => s.to)).toEqual([4]);
    expect(db.tables.app_settings!.find((s) => s.key === SIMILAR_CURSOR_KEY)!.value).toBe("13");
  });

  it("раздел скрыт (или скрыт его родитель) — ничего не предлагаем", async () => {
    const { db, ctx } = setup();
    const PARENT = "c0000000-0000-4000-8000-0000000000ff";
    db.tables.categories = [
      { id: PARENT, parent_id: null, is_visible: false },
      { id: CAT_A, parent_id: PARENT, is_visible: true },
      { id: CAT_B, parent_id: null, is_visible: true },
    ];
    const { sent, send } = collect();
    await runSimilar(ctx, send, NOW);
    expect(sent).toEqual([]);
  });

  it("общий потолок: сегодня уже было маркетинговое сообщение — «похожие» не шлём", async () => {
    const { db, ctx } = setup();
    const u = db.tables.bot_users!.find((x) => Number(x.telegram_id) === 1)!;
    u.state = { last_marketing_at: new Date(NOW.getTime() - 3_600_000).toISOString() };
    const { sent, send } = collect();
    await runSimilar(ctx, send, NOW);
    expect(sent).toEqual([]);
    // Курсор заказ прошёл, но он не потерян: отложен до свободного места.
    const deferred = db.tables.app_settings!.find((x) => x.key === SIMILAR_DEFERRED_KEY);
    expect(JSON.parse(String(deferred?.value)).map((o: { id: number }) => o.id)).toHaveLength(1);

    // Через сутки место освободилось — отложенные «похожие» уходят, и один раз.
    const tomorrow = new Date(NOW.getTime() + DAY);
    const next = collect();
    await runSimilar(ctx, next.send, tomorrow);
    expect(next.sent.map((x) => x.to)).toEqual([1]);
    const again = collect();
    await runSimilar(ctx, again.send, new Date(tomorrow.getTime() + 2 * DAY));
    expect(again.sent).toEqual([]);
  });

  it("после отправки «похожих» у покупателя стоит метка потолка", async () => {
    const { db, ctx } = setup();
    await runSimilar(ctx, collect().send, NOW);
    const u = db.tables.bot_users!.find((x) => Number(x.telegram_id) === 1)!;
    expect(u.state).toMatchObject({ last_marketing_at: NOW.toISOString() });
  });

  it("есть заказ новее — по старому не пишет", async () => {
    const { db, ctx } = setup();
    db.tables.orders!.push({
      id: 20,
      telegram_id: 1,
      platform: "telegram",
      status: "delivered",
      created_at: ago(1),
    });
    const { sent, send } = collect();
    await runSimilar(ctx, send, NOW);
    expect(sent).toEqual([]);
  });

  it("параллельный запуск, сдвинувший курсор, не даёт отправить дважды", async () => {
    const { db, ctx } = setup();
    const { sent, send } = collect();
    // Другой запуск успел занять заказы между чтением курсора и захватом.
    const origFrom = db.from.bind(db);
    let moved = false;
    (db as { from: typeof db.from }).from = ((table: string) => {
      if (table === "orders" && !moved) {
        moved = true;
        db.tables.app_settings!.push({ key: SIMILAR_CURSOR_KEY, value: "12" });
      }
      return origFrom(table);
    }) as typeof db.from;
    const r = await runSimilar(ctx, send, NOW);
    expect(r.skipped).toBe("busy");
    expect(sent).toEqual([]);
  });

  it("курсор уже был и его сдвинули между чтением и захватом — тихо уступаем", async () => {
    const { db, ctx } = setup();
    db.tables.app_settings!.push({ key: SIMILAR_CURSOR_KEY, value: "5" });
    const origFrom = db.from.bind(db);
    let moved = false;
    (db as { from: typeof db.from }).from = ((table: string) => {
      if (table === "orders" && !moved) {
        moved = true;
        db.tables.app_settings!.find((x) => x.key === SIMILAR_CURSOR_KEY)!.value = "12";
      }
      return origFrom(table);
    }) as typeof db.from;
    const { sent, send } = collect();
    expect((await runSimilar(ctx, send, NOW)).skipped).toBe("busy");
    expect(sent).toEqual([]);
  });

  it("ночью, без модуля и выключенное — молчит", async () => {
    const night = new Date("2026-09-27T17:00:00Z"); // 22:00 в Алматы
    expect((await runSimilar(setup().ctx, collect().send, night)).skipped).toBe("night");
    expect((await runSimilar(setup({}).ctx, collect().send, NOW)).skipped).toBe("module off");
    const { db, ctx } = setup();
    db.tables.app_settings = [];
    expect((await runSimilar(ctx, collect().send, NOW)).skipped).toBe("disabled");
  });

  it("при первом включении старые покупки не догоняет", async () => {
    const { db, ctx } = setup();
    for (const o of db.tables.orders!) o.created_at = ago(40);
    const { sent, send } = collect();
    await runSimilar(ctx, send, NOW);
    expect(sent).toEqual([]);
  });
});

describe("похожие материалы: ничего не теряется молча", () => {
  it("больше пачки заказов: следующие запуски продолжают с курсора, каждый получает один раз", async () => {
    const { db, ctx } = setup();
    db.tables.bot_users = [];
    db.tables.orders = [];
    db.tables.order_items = [];
    db.tables.blocked_users = [];
    const N = 120;
    for (let tg = 100; tg < 100 + N; tg++) {
      db.tables.bot_users.push({
        user_key: `tg_${tg}`,
        telegram_id: tg,
        platform: "telegram",
        first_name: `П${tg}`,
        opt_out: false,
        state: {},
      });
      db.tables.orders.push({
        id: tg,
        telegram_id: tg,
        platform: "telegram",
        status: "delivered",
        created_at: ago(8),
      });
      db.tables.order_items.push({ order_id: tg, product_id: A });
    }
    const got: number[] = [];
    for (let run = 0; run < 6; run++) {
      const { sent, send } = collect();
      await runSimilar(ctx, send, new Date(NOW.getTime() + run * 3_600_000));
      got.push(...sent.map((s) => s.to));
    }
    expect(new Set(got).size).toBe(N);
    expect(got).toHaveLength(N);
  });

  it("блокировки не прочитались — ошибка, сообщение не уходит", async () => {
    const { db, ctx } = setup();
    const real = db.from;
    db.from = (t) => {
      if (t !== "blocked_users") return real(t);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.in = () => q;
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: { message: "boom" } });
      return q as never;
    };
    const { sent, send } = collect();
    await expect(runSimilar(ctx, send, NOW)).rejects.toMatchObject({
      message: expect.stringContaining("блокировки"),
    });
    expect(sent).toEqual([]);
  });
});
