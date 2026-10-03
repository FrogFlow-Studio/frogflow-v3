import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { OFFERS_KEY, listOffers, resetOffersCache } from "./offers";
import { announceOffer, offerAnnouncedKey } from "./announce";
import { offerRemindedKey, runOfferReminders, type OfferReminder } from "./remind";

const BOT = "00000000-0000-0000-0000-0000000000d5";
const P1 = "11111111-1111-4111-8111-111111111111";
// «Сейчас» — полдень по Алматы (UTC+5) за двое суток до конца акции.
const NOW = new Date("2026-10-10T07:00:00Z");
const ENDS = "2026-10-12T18:59:00Z";

function shop(over: { offers?: unknown[]; users?: Array<Record<string, unknown>> } = {}) {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] }, maxRows: 1000 });
  const offer = {
    id: "o1",
    product_id: P1,
    percent: 20,
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: ENDS,
    limit: null,
  };
  db.tables.app_settings = [
    { bot_id: BOT, key: OFFERS_KEY, value: JSON.stringify(over.offers ?? [offer]) },
  ];
  db.tables.products = [{ id: P1, bot_id: BOT, name: "Торт", price: 10000, currency: "KZT" }];
  db.tables.categories = [];
  db.tables.order_items = [];
  db.tables.orders = [];
  db.tables.blocked_users = [];
  db.tables.broadcasts = [];
  db.tables.broadcast_recipients = [];
  db.tables.bot_users = (
    over.users ?? [
      { user_key: "tg_101", telegram_id: 101, platform: "telegram", state: {}, opt_out: false },
      {
        user_key: "tg_102",
        telegram_id: 102,
        platform: "telegram",
        state: { locale: "kk" },
        opt_out: false,
      },
      { user_key: "tg_103", telegram_id: 103, platform: "telegram", state: {}, opt_out: true },
    ]
  ).map((u) => ({ bot_id: BOT, ...u }));
  const ctx = {
    tenant: {
      id: BOT,
      modules: { limited_offers: true, broadcasts: true },
      settings: { served_by: "v2", default_locale: "ru" },
      telegramTokenEnc: "x",
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
  return { db, ctx };
}

beforeEach(() => resetOffersCache());

describe("«Позвать покупателей»", () => {
  it("создаёт рассылку с товаром и запоминает её; отписавшийся не получает", async () => {
    const { db, ctx } = shop();
    const r = await announceOffer(ctx, "o1", NOW);
    expect(r.recipients).toBe(2);
    const b = db.tables.broadcasts![0]!;
    expect(b.message_text).toContain("Торт");
    expect(b.message_text).toContain("−20 %");
    expect(b.product_ids).toEqual([P1]);
    const o = (await listOffers(ctx))[0]!;
    expect(o).toMatchObject({ broadcast_id: b.id, announced_at: NOW.toISOString() });
  });

  it("в рассылку кладутся тексты на всех четырёх языках", async () => {
    const { db, ctx } = shop();
    await announceOffer(ctx, "o1", NOW);
    const texts = (db.tables.broadcasts![0]!.audience_filter as { texts: Record<string, string> })
      .texts;
    expect(Object.keys(texts).sort()).toEqual(["en", "kk", "ru", "uz"]);
    expect(texts.kk).toContain("Акция");
    expect(texts.kk).toContain("дейін");
    expect(texts.en).toContain("Sale");
  });

  it("второй клик не шлёт вторую рассылку", async () => {
    const { db, ctx } = shop();
    const results = await Promise.allSettled([
      announceOffer(ctx, "o1", NOW),
      announceOffer(ctx, "o1", NOW),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(db.tables.broadcasts).toHaveLength(1);
    await expect(announceOffer(ctx, "o1", NOW)).rejects.toMatchObject({
      key: "err.admin.offerAnnounced",
    });
  });

  it("не вышло создать рассылку — метка снимается и можно повторить", async () => {
    const { db, ctx } = shop({ users: [] });
    await expect(announceOffer(ctx, "o1", NOW)).rejects.toMatchObject({
      key: "err.admin.offerAnnounceNone",
    });
    expect(db.tables.app_settings!.some((r) => r.key === offerAnnouncedKey("o1"))).toBe(false);
  });

  it("без модуля рассылок и после конца акции — отказ", async () => {
    const { ctx } = shop();
    (ctx.tenant.modules as Record<string, boolean>).broadcasts = false;
    await expect(announceOffer(ctx, "o1", NOW)).rejects.toMatchObject({
      key: "err.admin.offerAnnounceModule",
    });
    (ctx.tenant.modules as Record<string, boolean>).broadcasts = true;
    await expect(announceOffer(ctx, "o1", new Date("2026-10-13T00:00:00Z"))).rejects.toMatchObject({
      key: "err.admin.offerAnnounceEnded",
    });
  });
});

describe("напоминание «акция кончается завтра»", () => {
  /** Звали за 4 дня до конца; рассылка дошла до 101 и 102 (103 отписан), 104 — «не отправлено». */
  async function announced() {
    const s = shop();
    s.db.tables.broadcasts!.push({ id: "b1", bot_id: BOT });
    s.db.tables.broadcast_recipients!.push(
      ...[101, 102, 103].map((id) => ({
        id: `r${id}`,
        bot_id: BOT,
        broadcast_id: "b1",
        telegram_id: id,
        status: "sent",
      })),
      { id: "r104", bot_id: BOT, broadcast_id: "b1", telegram_id: 104, status: "failed" },
    );
    const row = s.db.tables.app_settings!.find((r) => r.key === OFFERS_KEY)!;
    row.value = JSON.stringify([
      {
        ...JSON.parse(String(row.value))[0],
        broadcast_id: "b1",
        announced_at: "2026-10-08T07:00:00Z",
      },
    ]);
    return s;
  }
  // Акция до 23:59 12.10 по Алматы; «сейчас» — 13:00 накануне, 11.10.
  const SOON = new Date("2026-10-11T08:00:00Z");

  it("уходит один раз каждому, кто получил рассылку и не отписан, на его языке", async () => {
    const { ctx } = await announced();
    const got: OfferReminder[] = [];
    const send = async (r: OfferReminder) => (got.push(r), true);
    const r = await runOfferReminders(ctx, send, SOON);
    expect(r).toMatchObject({ offers: 1, sent: 2, failed: 0 });
    expect(got.map((x) => x.telegramId).sort()).toEqual([101, 102]);
    expect(got.find((x) => x.telegramId === 102)!.text).toContain("ертең");
    expect(got.find((x) => x.telegramId === 101)!.text).toContain("завтра");
    // Повтор крона — тишина.
    expect(await runOfferReminders(ctx, send, SOON)).toMatchObject({ offers: 0, sent: 0 });
    expect(got).toHaveLength(2);
  });

  it("конец 23:59 — напоминание приходит днём накануне со словом «завтра»; в день конца — «сегодня»", async () => {
    const { ctx } = await announced();
    const got: OfferReminder[] = [];
    // 11.10 в 06:00 по Алматы окно ещё закрыто, ночью не пишем; днём накануне — «завтра».
    for (const t of ["2026-10-11T01:00:00Z", "2026-10-11T08:00:00Z"])
      await runOfferReminders(ctx, async (r) => (got.push(r), true), new Date(t));
    expect(got.every((r) => r.text.includes("завтра") || r.text.includes("ертең"))).toBe(true);
    expect(got).toHaveLength(2);
  });

  it("пропустили накануне — в день конца текст честно говорит «сегодня»", async () => {
    const { ctx } = await announced();
    const got: OfferReminder[] = [];
    // 12.10, 10:00 по Алматы: акция кончается в 23:59 этого же дня.
    await runOfferReminders(
      ctx,
      async (r) => (got.push(r), true),
      new Date("2026-10-12T05:00:00Z"),
    );
    expect(got).toHaveLength(2);
    expect(got.find((r) => r.telegramId === 101)!.text).toContain("сегодня");
    expect(got.find((r) => r.telegramId === 102)!.text).toContain("бүгін");
    expect(got.some((r) => /завтра|ертең/.test(r.text))).toBe(false);
  });

  it("два крона одновременно — отправляет один", async () => {
    const { ctx, db } = await announced();
    const got: number[] = [];
    const send = async (r: OfferReminder) => {
      await new Promise((x) => setTimeout(x, 3));
      got.push(r.telegramId);
      return true;
    };
    await Promise.all([runOfferReminders(ctx, send, SOON), runOfferReminders(ctx, send, SOON)]);
    expect(got.sort()).toEqual([101, 102]);
    expect(db.tables.app_settings!.filter((r) => r.key === offerRemindedKey("o1"))).toHaveLength(1);
  });

  it("раньше суток до конца, ночью, после конца и без рассылки — не шлёт", async () => {
    const { ctx } = await announced();
    const send = vi.fn(async () => true);
    for (const t of [
      "2026-10-10T07:00:00Z", // окно ещё не открылось
      "2026-10-12T20:00:00Z", // акция кончилась
      "2026-10-12T02:00:00Z", // 07:00 по Алматы — ночь
    ])
      await runOfferReminders(ctx, send, new Date(t));
    const plain = shop();
    await runOfferReminders(plain.ctx, send, SOON);
    expect(send).not.toHaveBeenCalled();
  });

  it("звали меньше чем за сутки до конца — напоминания нет", async () => {
    const { ctx, db } = await announced();
    const row = db.tables.app_settings!.find((r) => r.key === OFFERS_KEY)!;
    row.value = JSON.stringify([
      { ...JSON.parse(String(row.value))[0], announced_at: "2026-10-12T00:00:00Z" },
    ]);
    const send = vi.fn(async () => true);
    await runOfferReminders(ctx, send, SOON);
    expect(send).not.toHaveBeenCalled();
  });

  it("потолок маркетинга: кому уже писали сегодня — не пишем", async () => {
    const { ctx, db } = await announced();
    const u = db.tables.bot_users!.find((x) => x.user_key === "tg_101")!;
    u.state = { last_marketing_at: new Date(SOON.getTime() - 3_600_000).toISOString() };
    const got: number[] = [];
    const r = await runOfferReminders(ctx, async (x) => (got.push(x.telegramId), true), SOON);
    expect(got).toEqual([102]);
    expect(r.capped).toBe(1);
  });

  it("клиент v1 не получает ничего", async () => {
    const { ctx } = await announced();
    (ctx.tenant.settings as { served_by?: string }).served_by = "v1";
    const send = vi.fn(async () => true);
    expect(await runOfferReminders(ctx, send, SOON)).toMatchObject({ skipped: "not v2" });
    expect(send).not.toHaveBeenCalled();
  });
});
