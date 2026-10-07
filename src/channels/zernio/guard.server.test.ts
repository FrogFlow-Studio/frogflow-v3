import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { setEnvForTests } from "@/config/env";
import type { Tenant } from "@/core/tenant/types";

/**
 * Страж каналов с базой в памяти: два крона или крон и событие в один момент
 * дают одно сообщение продавцу; ожил — «снова работает» один раз; клиент v1
 * пропущен; сбой чтения не превращается в «всё хорошо».
 */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db, tenantDb: () => db }));
vi.mock("@/core/helpdesk/seller-texts", () => ({ noticeLocale: async () => "ru" }));
const sent: Array<{ html: string; opts: { replyMarkup?: unknown } }> = [];
vi.mock("@/channels/telegram/notify", () => ({
  notifyAdminsHtml: vi.fn(async (_c: unknown, html: string, opts: { replyMarkup?: unknown }) => {
    sent.push({ html, opts });
    return 1;
  }),
}));

const { runChannelGuardFor, markChannelDown, recordSendFailure, webhookOkByProfile } =
  await import("./guard.server");
const { tenantContext } = await import("@/core/tenant/resolve.server");

const BOT = "00000000-0000-4000-8000-0000000000aa";
const V1 = "00000000-0000-4000-8000-0000000000bb";

function tenant(id: string, servedBy: "v1" | "v2", expired: boolean): Tenant {
  return {
    id,
    name: "Магазин",
    status: "active",
    vertical: "digital",
    modules: {},
    archived: false,
    settings: {
      served_by: servedBy,
      timezone: "Asia/Almaty",
      zernio: { accounts: [{ id: "acc", platform: "instagram", expired }] },
    },
  } as unknown as Tenant;
}

const guardOf = (id: string) =>
  (db.tables.bots!.find((b) => b.id === id)!.settings as { zernio?: { guard?: unknown } }).zernio
    ?.guard;

beforeEach(() => {
  setEnvForTests({});
  sent.length = 0;
  db = fakeDb();
  db.tables.bots = [BOT, V1].map((id) => ({
    id,
    settings: { served_by: id === BOT ? "v2" : "v1", rev: 1, zernio: { accounts: [] } },
  }));
});
afterEach(() => setEnvForTests(undefined));

describe("крон стража", () => {
  it("слетел токен: одно сообщение с кнопкой «Переподключить» и временем начала", async () => {
    const r = await runChannelGuardFor([tenant(BOT, "v2", true)], true);
    expect(r).toMatchObject({ tenants: 1, down: 1, up: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toMatch(/Instagram отвалился с \d\d:\d\d/);
    expect(JSON.stringify(sent[0]!.opts.replyMarkup)).toContain("Переподключить");
    expect(guardOf(BOT)).toMatchObject({ instagram: { reason: "token" } });
  });

  it("два крона одновременно — одно уведомление (гонка)", async () => {
    const t = tenant(BOT, "v2", true);
    await Promise.all([runChannelGuardFor([t], true), runChannelGuardFor([t], true)]);
    expect(sent).toHaveLength(1);
  });

  it("повторный прогон, пока канал лежит, — тишина", async () => {
    const t = tenant(BOT, "v2", true);
    await runChannelGuardFor([t], true);
    await runChannelGuardFor([t], true);
    expect(sent).toHaveLength(1);
  });

  it("канал ожил — «снова работает» один раз, запись убрана; два крона — одно сообщение", async () => {
    await runChannelGuardFor([tenant(BOT, "v2", true)], true);
    sent.length = 0;
    const ok = tenant(BOT, "v2", false);
    await Promise.all([runChannelGuardFor([ok], true), runChannelGuardFor([ok], true)]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain("снова работает");
    expect(guardOf(BOT)).toEqual({});
    await runChannelGuardFor([ok], true);
    expect(sent).toHaveLength(1);
  });

  it("отключён вебхук: Instagram с живым токеном тоже «лёг»; не удалось проверить (null) — тишина", async () => {
    await runChannelGuardFor([tenant(BOT, "v2", false)], null);
    expect(sent).toHaveLength(0);
    await runChannelGuardFor([tenant(BOT, "v2", false)], false);
    expect(sent).toHaveLength(1);
    expect(guardOf(BOT)).toMatchObject({ instagram: { reason: "webhook" } });
  });

  it("вебхук не проверен (null): лежавший канал не объявляется «снова работает», запись остаётся (Л4)", async () => {
    await runChannelGuardFor([tenant(BOT, "v2", false)], false);
    sent.length = 0;
    await runChannelGuardFor([tenant(BOT, "v2", false)], null);
    expect(sent).toHaveLength(0);
    expect(guardOf(BOT)).toMatchObject({ instagram: { reason: "webhook" } });
    // Дальше проверили — вебхук в порядке: «ожил» один раз.
    await runChannelGuardFor([tenant(BOT, "v2", false)], true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain("снова работает");
  });

  it("продавец отключил канал: запись убрана без сообщения «снова работает» (Л4)", async () => {
    await runChannelGuardFor([tenant(BOT, "v2", true)], true);
    sent.length = 0;
    const disconnected = tenant(BOT, "v2", false);
    // Как в справочнике арендаторов: аккаунтов нет, запись стража (guard) в настройках осталась.
    const z = (disconnected.settings as { zernio?: Record<string, unknown> }).zernio!;
    z.accounts = [];
    z.guard = guardOf(BOT);
    const r = await runChannelGuardFor([disconnected], true);
    expect(sent).toHaveLength(0);
    expect(guardOf(BOT)).toEqual({});
    expect(r).toMatchObject({ down: 0, up: 0 });
  });

  it("клиент v1 пропущен: ни записи, ни сообщения", async () => {
    const r = await runChannelGuardFor([tenant(V1, "v1", true)], false);
    expect(r.tenants).toBe(0);
    expect(sent).toHaveLength(0);
    expect(guardOf(V1)).toBeUndefined();
  });

  it("запись не затирает чужие ключи settings и растит rev", async () => {
    (db.tables.bots![0]!.settings as Record<string, unknown>).slug = "shop";
    await runChannelGuardFor([tenant(BOT, "v2", true)], true);
    const s = db.tables.bots![0]!.settings as Record<string, unknown>;
    expect(s.slug).toBe("shop");
    expect(s.served_by).toBe("v2");
    expect(s.rev).toBe(2);
  });

  it("сбой чтения настроек — ошибка в отчёте клиента, а не «уведомил»", async () => {
    const real = db.from.bind(db);
    (db as { from: unknown }).from = (table: string) =>
      table === "bots"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
              }),
            }),
          }
        : real(table);
    const r = await runChannelGuardFor([tenant(BOT, "v2", true)], true);
    expect(Object.keys(r.errors)).toEqual([BOT]);
    expect(sent).toHaveLength(0);
  });
});

describe("события вебхука и крон сходятся в одну запись", () => {
  it("account.disconnected и крон одновременно — одно сообщение", async () => {
    const t = tenant(BOT, "v2", true);
    const ctx = tenantContext(t);
    await Promise.all([markChannelDown(ctx, "instagram", "token"), runChannelGuardFor([t], true)]);
    expect(sent).toHaveLength(1);
  });
});

describe("серия сбоев отправки", () => {
  it("третий сбой подряд — сообщение один раз; четвёртый и пятый молчат", async () => {
    const ctx = tenantContext(tenant(BOT, "v2", false));
    const res = [];
    for (let i = 0; i < 5; i++) res.push((await recordSendFailure(ctx, "whatsapp")).notified);
    expect(res).toEqual([false, false, true, false, false]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain("WhatsApp отвалился");
  });

  it("сбои параллельно: порог пересекается один раз", async () => {
    const ctx = tenantContext(tenant(BOT, "v2", false));
    await Promise.all(Array.from({ length: 6 }, () => recordSendFailure(ctx, "whatsapp")));
    expect(sent.length).toBeLessThanOrEqual(1);
  });
});

describe("вебхук отстал от нового клиента (ложная тревога 07.10)", () => {
  const OTHER = "00000000-0000-4000-8000-0000000000cc";
  const withProfile = (id: string, profile: string): Tenant => {
    const t = tenant(id, "v2", false);
    t.settings.zernio = { ...t.settings.zernio, profile_id: profile };
    return t;
  };

  it("клиент в записи — тишина; «отвалился» только у того, чьего профиля в записи нет", async () => {
    db.tables.bots!.push({
      id: OTHER,
      settings: { served_by: "v2", rev: 1, zernio: { accounts: [] } },
    });
    const old = withProfile(BOT, "p-old");
    const fresh = withProfile(OTHER, "p-new");
    await runChannelGuardFor([old, fresh], webhookOkByProfile(["p-old"]));
    expect(sent).toHaveLength(1);
    expect(guardOf(BOT)).toBeUndefined();
    expect(guardOf(OTHER)).toMatchObject({ instagram: { reason: "webhook" } });
  });

  it("снимка записи нет (не прочитали) или у магазина нет профиля — никого не будим", async () => {
    await runChannelGuardFor([withProfile(BOT, "p-old")], webhookOkByProfile(null));
    await runChannelGuardFor([tenant(BOT, "v2", false)], webhookOkByProfile(["p-old"]));
    expect(sent).toHaveLength(0);
  });

  it("запись выключена (пустой список) — «отвалился» у каждого клиента", async () => {
    await runChannelGuardFor([withProfile(BOT, "p-old")], webhookOkByProfile([]));
    expect(sent).toHaveLength(1);
    expect(guardOf(BOT)).toMatchObject({ instagram: { reason: "webhook" } });
  });
});
