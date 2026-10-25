import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import type { Tenant } from "@/core/tenant/types";
import { settingsFromJson } from "@/core/tenant/directory";
import { runBuyReminders, sendBuyReminders } from "./buy-reminder.server";
import type { ZernioTransport } from "./api.server";

/**
 * Напоминание с кнопкой «Купить» (Копилка 21–25.10: 18 из 25 молчали после
 * ответа с ценой): одно на ответ бота, днём, в окне 24 часа, только если
 * последний ответ был с кнопкой и заказа после него нет.
 */
const now = new Date("2026-10-25T08:00:00Z"); // 13:00 по Алматы
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const P = "aaaaaaaa-0000-4000-8000-000000000001";
const V = "bbbbbbbb-0000-4000-8000-000000000002";

type Tables = Record<string, Array<Record<string, unknown>>>;
const tables = (c: TenantContext) => (c.db as unknown as { tables: Tables }).tables;

function ctxOf(features: string | null = '{"buy_reminder":true}'): TenantContext {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = features
    ? [{ bot_id: "b1", key: "whatsapp_bot_features", value: features }]
    : [];
  db.tables.products = [{ id: P, bot_id: "b1", name: "Папки МО ЕМН и ОГН", is_active: true }];
  db.tables.product_variants = [
    { id: V, product_id: P, name: "Папка МО ЕМН для Казахстана", price: 3500, sort_order: 0 },
  ];
  db.tables.orders = [];
  db.tables.bot_users = [
    {
      bot_id: "b1",
      user_key: "wa_1",
      platform: "whatsapp",
      telegram_id: -1,
      zernio_conversation_id: "conv1",
      zernio_account_id: "acc1",
      updated_at: hoursAgo(4),
      state: {
        consultant: {
          recent: [
            { role: "customer", text: "Здравствуйте. Интересует папка МО ЕМН" },
            { role: "assistant", text: "Папка МО ЕМН для Казахстана — 3 500 ₸." },
          ],
          last_reply_at: hoursAgo(4),
          buy_offer: { productId: P, variantId: V, at: hoursAgo(4) },
        },
      },
    },
  ];
  return {
    tenant: {
      id: `b1-${Math.random()}`,
      settings: settingsFromJson({}),
      modules: { wa_shop: true },
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

type Tail = Awaited<ReturnType<ZernioTransport["tail"]>>;
const asked = (h = 4.1) =>
  [
    {
      direction: "incoming",
      message: "Здравствуйте. Интересует папка МО ЕМН",
      createdAt: hoursAgo(h),
    },
    {
      direction: "outgoing",
      message: "Папка МО ЕМН для Казахстана — 3 500 ₸.",
      createdAt: hoursAgo(4),
    },
  ] as Tail;
const transport = (tail: () => Promise<Tail> = async () => asked(), ok = true) => {
  const send = vi.fn(async () =>
    ok ? { ok: true as const } : { ok: false as const, error: "timeout" },
  );
  return { t: { send, tail: vi.fn(tail) } as unknown as ZernioTransport, send };
};
const consultantOf = (ctx: TenantContext) =>
  (tables(ctx).bot_users![0]!.state as { consultant: Record<string, unknown> }).consultant;

describe("напоминание с кнопкой «Купить»", () => {
  it("тишина 4 часа после ответа с кнопкой — одно сообщение с кнопкой, второй крон не повторяет", async () => {
    const ctx = ctxOf();
    const { t, send } = transport();
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 1 });
    expect(send.mock.calls[0]).toEqual([
      "conv1",
      "acc1",
      "Если ещё актуально, оставлю кнопку для «Папки МО ЕМН и ОГН — Папка МО ЕМН для Казахстана»: одно нажатие — и пришлю оплату 👇",
      expect.objectContaining({
        platform: "whatsapp",
        buttons: [{ type: "postback", title: "🛒 Купить", payload: `CBUY:${P}:${V}` }],
      }),
    ]);
    const c = consultantOf(ctx);
    expect(c.followup_for).toBe(hoursAgo(4));
    expect(c.relayed).toEqual([expect.stringContaining("оставлю кнопку")]);
    expect((c.recent as { text: string }[]).at(-1)!.text).toContain("оставлю кнопку");

    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("два крона одновременно — одно напоминание", async () => {
    const ctx = ctxOf();
    const { t, send } = transport();
    const [a, b] = await Promise.all([
      sendBuyReminders(ctx, now, t),
      sendBuyReminders(ctx, now, t),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("по умолчанию выключено — не пишем", async () => {
    const { t, send } = transport();
    expect(await sendBuyReminders(ctxOf(null), now, t)).toMatchObject({ skipped: "off" });
    expect(send).not.toHaveBeenCalled();
  });

  it("выключена сама кнопка «Купить» — напоминание тоже молчит", async () => {
    const { t, send } = transport();
    const ctx = ctxOf('{"buy_reminder":true,"buy_button":false}');
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ skipped: "off" });
    expect(send).not.toHaveBeenCalled();
  });

  it("продавец выключил консультанта — не пишем", async () => {
    const ctx = ctxOf();
    tables(ctx).app_settings!.push({ bot_id: "b1", key: "consultant_enabled", value: "false" });
    const { t, send } = transport();
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ skipped: "consultant_off" });
    expect(send).not.toHaveBeenCalled();
  });

  it("ночью (01:00 по Алматы) — ждём утра, ответ не отмечаем", async () => {
    const ctx = ctxOf();
    const night = new Date("2026-10-25T20:00:00Z");
    const { t, send } = transport();
    expect(await sendBuyReminders(ctx, night, t)).toMatchObject({ skipped: "night" });
    expect(send).not.toHaveBeenCalled();
    expect(consultantOf(ctx).followup_for).toBeUndefined();
  });

  it("последний ответ бота был без кнопки — старую кнопку не напоминаем", async () => {
    const ctx = ctxOf();
    consultantOf(ctx).buy_offer = { productId: P, variantId: V, at: hoursAgo(6) };
    const { t, send } = transport();
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("меньше 3 часов тишины — рано", async () => {
    const ctx = ctxOf();
    Object.assign(consultantOf(ctx), {
      last_reply_at: hoursAgo(2),
      buy_offer: { productId: P, variantId: V, at: hoursAgo(2) },
    });
    const { t, send } = transport();
    await sendBuyReminders(ctx, now, t);
    expect(send).not.toHaveBeenCalled();
  });

  it("после ответа покупатель оформил заказ — не пишем, ответ отмечен", async () => {
    const ctx = ctxOf();
    tables(ctx).orders!.push({ id: 1, bot_id: "b1", telegram_id: -1, created_at: hoursAgo(3.5) });
    const { t, send } = transport();
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0, ordered: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(consultantOf(ctx).followup_for).toBe(hoursAgo(4));
  });

  it("заказ был раньше ответа — напоминание уходит", async () => {
    const ctx = ctxOf();
    tables(ctx).orders!.push({ id: 1, bot_id: "b1", telegram_id: -1, created_at: hoursAgo(30) });
    const { t } = transport();
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 1 });
  });

  it("товар сняли с продажи — не пишем, ответ отмечен", async () => {
    const ctx = ctxOf();
    tables(ctx).products![0]!.is_active = false;
    const { t, send } = transport();
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0, gone: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("покупатель написал после ответа бота — не пишем, ответ отмечен", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(async () => [
      ...asked(),
      {
        direction: "incoming",
        message: "Спасибо, подумаю",
        createdAt: hoursAgo(3.5),
      } as Tail[number],
    ]);
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0, window: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("покупатель писал больше 23 часов назад — окно WhatsApp закрывается: не пишем", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(async () => asked(23.5));
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0, window: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("менеджер ответил из приложения после бота — не пишем", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(async () => [
      ...asked(),
      {
        direction: "outgoing",
        message: "Кристина: пришлю вам образец",
        createdAt: hoursAgo(3),
      } as Tail[number],
    ]);
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0, manager: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("диалог на паузе у продавца — не пишем", async () => {
    const ctx = ctxOf();
    consultantOf(ctx).paused_until = hoursAgo(-2);
    const { t, send } = transport();
    await sendBuyReminders(ctx, now, t);
    expect(send).not.toHaveBeenCalled();
  });

  it("отправка оборвалась — второй раз не шлём (могло дойти)", async () => {
    const ctx = ctxOf();
    const { t, send } = transport(undefined, false);
    expect(await sendBuyReminders(ctx, now, t)).toMatchObject({ sent: 0 });
    await sendBuyReminders(ctx, now, t);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("покупатель выбрал казахский — напоминание и кнопка на казахском", async () => {
    const ctx = ctxOf();
    (tables(ctx).bot_users![0]!.state as Record<string, unknown>).locale = "kk";
    const { t, send } = transport();
    await sendBuyReminders(ctx, now, t);
    const [, , text, opts] = send.mock.calls[0] as unknown as [
      string,
      string,
      string,
      { buttons: { title: string }[] },
    ];
    expect(text).toContain("батырманы осында қалдырамын");
    expect(opts.buttons[0]!.title).toBe("🛒 Сатып алу");
  });

  it("консультант по прайсу и магазины без переписки в обход: у них своё напоминание", async () => {
    const { t, send } = transport();
    const base = ctxOf();
    const tenant = (settings: object, modules: object) =>
      ({ ...base.tenant, settings: settingsFromJson(settings), modules }) as unknown as Tenant;
    const out = await runBuyReminders(
      [tenant({ consultant_pricelist: { enabled: true } }, { wa_shop: true }), tenant({}, {})],
      now,
      t,
    );
    expect(out).toEqual({});
    expect(send).not.toHaveBeenCalled();
  });
});
