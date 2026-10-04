import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { userKey } from "@/core/customers/customers";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { handleTelegramUpdate } = await import("./handle-update");
const { createGiveaway } = await import("@/core/giveaways/giveaway");
const { giveawayIdFrom, giveawayJoinLabel } = await import("./giveaway");

const TG = 42;
const BOT = "bot-1";
const NOW = new Date();
const IN_WEEK = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();

function shop(opts: { module?: boolean; member?: string; locale?: string } = {}) {
  const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
  db.tables.bot_users = [
    {
      id: "u-1",
      user_key: userKey("telegram", TG),
      platform: "telegram",
      telegram_id: TG,
      opt_out: false,
      state: { locale: opts.locale ?? "ru" },
    },
  ];
  db.tables.categories = [];
  const ctx = {
    tenant: {
      id: BOT,
      status: "active",
      vertical: "digital",
      modules: { giveaways: opts.module ?? true },
      settings: { default_locale: "ru" },
    },
    db,
    appUrl: "https://app.test",
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  const calls: Array<[string, Record<string, unknown>]> = [];
  let status = opts.member ?? "member";
  const api = {
    call: vi.fn(async (method: string, payload: Record<string, unknown> = {}) => {
      calls.push([method, payload]);
      if (method === "getChatMember") return { ok: true, result: { status } };
      return { ok: true, result: {} };
    }),
  };
  const form = (patch: Record<string, unknown> = {}) => ({
    title: "Осень",
    prize: "Открытки",
    channel: "telegram" as const,
    conditions: "",
    endsAt: IN_WEEK,
    winners: 1,
    subscribeChannel: "",
    excludeBlocked: true,
    excludeStaff: true,
    ...patch,
  });
  const start = (payload: string) =>
    handleTelegramUpdate(
      ctx,
      api as never,
      {
        update_id: 1,
        message: {
          message_id: 1,
          date: 0,
          chat: { id: TG, type: "private" },
          from: { id: TG, is_bot: false, first_name: "A" },
          text: `/start ${payload}`,
        },
      } as never,
    );
  const tap = (data: string) =>
    handleTelegramUpdate(
      ctx,
      api as never,
      {
        update_id: 2,
        callback_query: {
          id: "cb",
          from: { id: TG, is_bot: false, first_name: "A" },
          message: { message_id: 5, chat: { id: TG, type: "private" } },
          data,
        },
      } as never,
    );
  const sent = () =>
    calls
      .filter(([m]) => m === "sendMessage")
      .map(([, p]) => p as { text: string; reply_markup?: never });
  const entries = () =>
    (db.tables.zernio_logs ?? []).filter((r) => r.event_type === "giveaway.entry");
  return { ctx, db, form, start, tap, sent, entries, setStatus: (s: string) => (status = s) };
}

describe("розыгрыш в боте: ссылка ?start=gw_ и кнопка", () => {
  it("разбор данных ссылки и кнопок", () => {
    expect(giveawayIdFrom("gw_abcd1234")).toBe("abcd1234");
    expect(giveawayIdFrom("gw:abcd1234")).toBe("abcd1234");
    expect(giveawayIdFrom("gwchk:abcd1234")).toBe("abcd1234");
    expect(giveawayIdFrom("gw_ABCD")).toBeNull();
    expect(giveawayIdFrom("gw_abcd1234; drop")).toBeNull();
  });

  it("ссылка записывает участника и отвечает по-русски; повтор — «уже участвуете»", async () => {
    const s = shop();
    const g = await createGiveaway(s.ctx, s.form(), NOW);
    await s.start(`gw_${g.id}`);
    expect(s.entries()).toHaveLength(1);
    expect(s.sent().at(-1)!.text).toContain("Вы участвуете в розыгрыше «Осень»");
    await s.start(`gw_${g.id}`);
    expect(s.entries()).toHaveLength(1);
    expect(s.sent().at(-1)!.text).toBe("Вы уже участвуете в этом розыгрыше.");
  });

  it("отвечает на языке покупателя", async () => {
    const s = shop({ locale: "en" });
    const g = await createGiveaway(s.ctx, s.form(), NOW);
    await s.tap(`gw:${g.id}`);
    expect(s.sent().at(-1)!.text).toContain("You are in the “Осень” giveaway");
    expect(giveawayJoinLabel("uz")).toContain("Qatnashish");
  });

  it("без подписки — кнопки канала и «Проверить ещё раз»; после подписки проверка принимает", async () => {
    const s = shop({ member: "left" });
    const g = await createGiveaway(s.ctx, s.form({ subscribeChannel: "@my_shop" }), NOW);
    await s.start(`gw_${g.id}`);
    expect(s.entries()).toHaveLength(0);
    const kb = JSON.stringify(s.sent().at(-1)!.reply_markup);
    expect(kb).toContain("https://t.me/my_shop");
    expect(kb).toContain(`gwchk:${g.id}`);
    s.setStatus("member");
    await s.tap(`gwchk:${g.id}`);
    expect(s.entries()).toHaveLength(1);
    expect(s.sent().at(-1)!.text).toContain("Вы участвуете");
  });

  it("закрытый розыгрыш — сообщение, участника нет", async () => {
    const s = shop();
    const g = await createGiveaway(s.ctx, s.form(), NOW);
    const { closeGiveaway } = await import("@/core/giveaways/giveaway");
    await closeGiveaway(s.ctx, g.id);
    await s.start(`gw_${g.id}`);
    expect(s.entries()).toHaveLength(0);
    expect(s.sent().at(-1)!.text).toBe("Приём участников в этом розыгрыше закончился.");
  });

  it("модуль выключен — ссылка и кнопка не участвуют", async () => {
    const s = shop({ module: false });
    await s.start("gw_abcd1234");
    await s.tap("gw:abcd1234");
    expect(s.entries()).toHaveLength(0);
    expect(s.sent().every((m) => !/розыгрыш/i.test(m.text))).toBe(true);
  });
});

describe("кнопка «Участвовать» под рассылкой", () => {
  const broadcast = {
    id: "00000000-0000-0000-0000-000000000001",
    message_text: "Розыгрыш!",
    audience_filter: {
      giveaway_id: "abcd1234",
      // Тексты по языкам включают язык покупателя и для кнопок (как у остальных кнопок рассылки).
      texts: { ru: "Розыгрыш!", kk: "Ұтыс ойыны!" },
    },
  };

  async function sendOne(modules: Record<string, boolean>, locale: string) {
    const { telegramBroadcastSender } = await import("./jobs");
    const { contentOf } = await import("@/core/broadcasts/broadcasts");
    const s = shop({ locale });
    (s.ctx.tenant as unknown as { modules: Record<string, boolean> }).modules = modules;
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      call: vi.fn(async (_m: string, p: Record<string, unknown> = {}) => {
        calls.push(p);
        return { ok: true, result: {} };
      }),
    };
    const row = broadcast as never;
    await telegramBroadcastSender(s.ctx, api as never)(
      { telegramId: TG, phone: null },
      contentOf(row),
      row,
    );
    const kb = calls[0]!.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    return kb.inline_keyboard.flat();
  }

  it("кнопка ведёт на участие, подпись на языке покупателя, метка клика сохраняется", async () => {
    const buttons = await sendOne({ giveaways: true }, "kk");
    const join = buttons.find((b) => b.callback_data.startsWith("gw:abcd1234"))!;
    expect(join.text).toBe(giveawayJoinLabel("kk"));
    expect(join.callback_data).toMatch(/^gw:abcd1234:b[0-9a-f]{8}$/);
    expect(giveawayIdFrom(join.callback_data.replace(/:b[0-9a-f]{8}$/, ""))).toBe("abcd1234");
  });

  it("модуль выключен — кнопки нет", async () => {
    const buttons = await sendOne({}, "ru");
    expect(buttons.some((b) => b.callback_data.startsWith("gw:"))).toBe(false);
  });
});
