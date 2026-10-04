import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";

vi.mock("@/lib/errors", () => ({ reportError: vi.fn(async () => {}) }));

const { createGiveaway, closeGiveaway, getGiveaway } = await import("./giveaway");
const { recordEntry } = await import("./entry");
const { drawWinners } = await import("./draw");
const { notifyGiveaway, noticeEventId } = await import("./notify");
type Deps = import("./notify").NoticeDeps;

const BOT = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-04T10:00:00.000Z");
const DRAWN = new Date("2026-10-12T10:00:00.000Z");
const nowFn = () => DRAWN.getTime() + 60_000;

function setup(settings: Record<string, unknown> = {}) {
  const db = fakeDb({
    unique: { zernio_logs: [["event_id"]], promo_codes: [["code"]] },
  });
  const ctx = {
    tenant: { id: BOT, modules: { blocked: true }, ownerTelegramId: null, settings },
    db,
  } as unknown as TenantContext;
  return { db, ctx };
}

const form = (patch: Record<string, unknown> = {}) => ({
  title: "Осень",
  prize: "Открытки",
  channel: "telegram" as const,
  conditions: "",
  endsAt: "2026-10-11T10:00:00.000Z",
  winners: 1,
  subscribeChannel: "",
  excludeBlocked: true,
  excludeStaff: true,
  ...patch,
});

function buyer(
  db: ReturnType<typeof setup>["db"],
  key: string,
  id: number,
  extra: Record<string, unknown> = {},
) {
  db.tables.bot_users = [
    ...(db.tables.bot_users ?? []),
    { bot_id: BOT, user_key: key, telegram_id: id, platform: "telegram", state: {}, ...extra },
  ];
}

async function drawn(
  ctx: TenantContext,
  db: ReturnType<typeof setup>["db"],
  n: number,
  patch: Record<string, unknown> = {},
  platform: "telegram" | "instagram" = "telegram",
) {
  const g = await createGiveaway(ctx, form(patch), NOW);
  for (let i = 1; i <= n; i++) {
    const key = `u_${i}`;
    buyer(
      db,
      key,
      i,
      platform === "instagram"
        ? { platform: "instagram", zernio_conversation_id: `c${i}`, zernio_account_id: "a1" }
        : {},
    );
    await recordEntry(ctx, g, { userKey: key, telegramId: i, channel: platform }, NOW);
  }
  await closeGiveaway(ctx, g.id, NOW);
  await drawWinners(ctx, g.id, null, DRAWN);
  return (await getGiveaway(ctx, g.id))!;
}

function deps(outcome: "sent" | "rejected" | "unknown" = "sent") {
  const sent: Array<{ key: string; html: string }> = [];
  const seller: string[] = [];
  const d: Deps = {
    async send(c, html) {
      await Promise.resolve();
      sent.push({ key: c.userKey, html });
      return outcome;
    },
    async notifySeller(html) {
      seller.push(html);
    },
  };
  return { d, sent, seller };
}

const logs = (db: ReturnType<typeof setup>["db"]) =>
  db.tables.zernio_logs!.filter((r) => r.event_type === "giveaway.notice");

describe("сообщение победителям", () => {
  it("победитель получает одноразовый промокод на языке покупателя, запись пишется один раз", async () => {
    const { ctx, db } = setup({ default_locale: "ru" });
    const g = await drawn(ctx, db, 1, { prizePromoPercent: 20, promoDays: 10 });
    db.tables.bot_users![0]!.state = { locale: "en" };
    const { d, sent } = deps();
    const r = await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(r).toMatchObject({ sent: 1, manual: 0, done: true });
    expect(sent).toHaveLength(1);
    const code = (db.tables.promo_codes ?? [])[0]!;
    expect(code).toMatchObject({
      discount_type: "percent",
      discount_value: 20,
      max_uses: 1,
      is_active: true,
    });
    expect(sent[0]!.html).toContain(String(code.code));
    expect(sent[0]!.html).toContain("You won");
    expect(sent[0]!.html).toContain("20%");
    const row = logs(db)[0]!;
    expect(row.event_id).toBe(noticeEventId(g.id, "prize", "u_1"));
    expect(row.status).toBe("sent");
    expect((row.payload as Record<string, unknown>).promo_code).toBe(code.code);
    // Повторный прогон — ни сообщения, ни второго кода.
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(1);
    expect(db.tables.promo_codes).toHaveLength(1);
  });

  it("два крона одновременно: одно сообщение и один промокод", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 1, { prizePromoPercent: 15 });
    const { d, sent } = deps();
    await Promise.all([
      notifyGiveaway(ctx, g.id, d, { now: nowFn }),
      notifyGiveaway(ctx, g.id, d, { now: nowFn }),
    ]);
    expect(sent).toHaveLength(1);
    expect(db.tables.promo_codes).toHaveLength(1);
    expect(logs(db)).toHaveLength(1);
  });

  it("без промокода в настройках — «продавец свяжется», код не выписывается", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 1);
    const { d, sent } = deps();
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent[0]!.html).toContain("Продавец свяжется");
    expect(db.tables.promo_codes ?? []).toHaveLength(0);
  });

  it("Instagram вне окна 24 часа: сообщения нет, продавцу — «напишите вручную»", async () => {
    const { ctx, db } = setup();
    const g = await drawn(
      ctx,
      db,
      1,
      { channel: "instagram", igAccountId: "a1", igPostId: "p1" },
      "instagram",
    );
    db.tables.manager_chat_messages = [
      {
        bot_id: BOT,
        telegram_id: 1,
        direction: "in",
        created_at: new Date(nowFn() - 30 * 3600_000).toISOString(),
      },
    ];
    const { d, sent, seller } = deps();
    const r = await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(0);
    expect(r.manual).toBe(1);
    expect(seller).toHaveLength(1);
    expect(seller[0]).toContain("напишите");
    expect(logs(db)[0]!.status).toBe("manual");
    // Второй прогон продавца не дёргает.
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(seller).toHaveLength(1);
  });

  it("Instagram в окне: сообщение уходит", async () => {
    const { ctx, db } = setup();
    const g = await drawn(
      ctx,
      db,
      1,
      { channel: "instagram", igAccountId: "a1", igPostId: "p1" },
      "instagram",
    );
    db.tables.manager_chat_messages = [
      {
        bot_id: BOT,
        telegram_id: 1,
        direction: "in",
        created_at: new Date(nowFn() - 3600_000).toISOString(),
      },
    ];
    const { d, sent } = deps();
    expect((await notifyGiveaway(ctx, g.id, d, { now: nowFn })).sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("отправка могла дойти (обрыв): статус unknown, не повторяется, продавцу — проверить", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 1, { prizePromoPercent: 10 });
    const { d, sent, seller } = deps("unknown");
    const r = await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(r.unknown).toBe(1);
    expect(logs(db)[0]!.status).toBe("unknown");
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(1);
    expect(seller).toHaveLength(1);
    expect(db.tables.promo_codes).toHaveLength(1);
  });

  it("отказ канала: статус manual, продавцу — задание, повторов нет", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 1);
    const { d, sent, seller } = deps("rejected");
    const r = await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(r.manual).toBe(1);
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(1);
    expect(seller).toHaveLength(1);
  });

  it("перевыбранный победитель получает своё сообщение, прежний не получает повторно", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 3);
    const { d, sent } = deps();
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(1);
    const { rerollWinner } = await import("./draw");
    const first = sent[0]!.key;
    await rerollWinner(ctx, g.id, first, "не ответил", null, DRAWN);
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.key).not.toBe(first);
  });

  it("не выбранный розыгрыш не рассылает", async () => {
    const { ctx } = setup();
    const g = await createGiveaway(ctx, form(), NOW);
    const { d, sent } = deps();
    const r = await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent).toHaveLength(0);
    expect(r.done).toBe(true);
  });

  it("бюджет вышел: остаток помечен left, следующий прогон дошлёт", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 3, { winners: 3 });
    const { d, sent } = deps();
    let t = 0;
    const first = await notifyGiveaway(ctx, g.id, d, {
      now: () => (t += 40_000),
      budgetMs: 60_000,
    });
    expect(first.left).toBeGreaterThan(0);
    expect(first.done).toBe(false);
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(new Set(sent.map((s) => s.key)).size).toBe(3);
    expect(sent).toHaveLength(3);
  });
});

describe("утешительный промокод остальным", () => {
  it("уходит один раз, каждому свой код; блокированному и сверх потолка маркетинга — нет", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 4, { winners: 1, consolationPercent: 5 });
    db.tables.blocked_users = [{ bot_id: BOT, telegram_id: 2 }];
    // Покупателю 3 уже писали маркетингом сегодня — потолок 1 в сутки.
    const winner = (await getGiveaway(ctx, g.id))!.result!.winners[0]!.userKey;
    const others = ["u_1", "u_2", "u_3", "u_4"].filter((k) => k !== winner);
    const capped = others.find((k) => k !== "u_2")!;
    db.tables.bot_users!.find((u) => u.user_key === capped)!.state = {
      last_marketing_at: new Date(nowFn() - 3600_000).toISOString(),
    };
    const { d, sent } = deps();
    const r = await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    const consolation = sent.filter((s) => s.key !== winner);
    const expected = others.filter((k) => k !== "u_2" && k !== capped);
    expect(consolation.map((s) => s.key).sort()).toEqual(expected.sort());
    expect(r.consolationSent).toBe(expected.length);
    expect(new Set((db.tables.promo_codes ?? []).map((p) => p.code)).size).toBe(
      db.tables.promo_codes!.length,
    );
    await notifyGiveaway(ctx, g.id, d, { now: nowFn });
    expect(sent.filter((s) => s.key !== winner)).toHaveLength(expected.length);
  });

  it("через несколько дней после выбора утешительные уже не уходят", async () => {
    const { ctx, db } = setup();
    const g = await drawn(ctx, db, 3, { consolationPercent: 5 });
    const { d, sent } = deps();
    await notifyGiveaway(ctx, g.id, d, { now: () => DRAWN.getTime() + 5 * 86_400_000 });
    expect(sent).toHaveLength(1);
  });
});
