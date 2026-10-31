import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { mergeMessages } from "./merge-messages";
import type { TenantContext } from "@/core/tenant/resolve.server";
import {
  inboundIntercepted,
  inboundLogText,
  isManagerConnected,
  lastInboundAt,
  listMessages,
  tappedButtonText,
} from "./chat";

const BOT = "11111111-1111-1111-1111-111111111111";

function setup(managerChat: boolean, active: boolean) {
  const touched: Array<Record<string, unknown>> = [];
  const db = fakeDb({
    rpc: { manager_chat_touch: (_d: FakeDb, a) => void touched.push(a) },
  });
  db.tables.manager_chat_state = [{ bot_id: BOT, telegram_id: 7, active, unread_count: 0 }];
  db.tables.manager_chat_messages = [];
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: { id: BOT, modules: { manager_chat: managerChat } },
    db,
  } as unknown as TenantContext;
  return { ctx, db, touched };
}

describe("чат с менеджером", () => {
  it("сообщение без текста пишется заглушкой по виду вложения", () => {
    expect(inboundLogText({ photo: [{}] })).toBe("[фото]");
    expect(inboundLogText({ document: {} })).toBe("[файл]");
    expect(inboundLogText({ contact: {} })).toBe("[контакт]");
    expect(inboundLogText({})).toBe("[без текста]");
    expect(inboundLogText({ text: "  ", caption: "чек за заказ", photo: [{}] })).toBe(
      "чек за заказ",
    );
    expect(inboundLogText({ text: "привет", photo: [{}] })).toBe("привет");
  });

  it("выключенный модуль — ничего не пишет, даже если в базе осталась активная строка", async () => {
    const s = setup(false, true);
    expect(await inboundIntercepted(s.ctx, 7, "привет")).toBe(false);
    expect(s.touched).toEqual([]);
    expect(s.db.tables.manager_chat_messages).toEqual([]);
    expect(s.db.tables.manager_chat_state![0]!.unread_count).toBe(0);
  });

  it("нажатая кнопка пишется подписью с 👉 и повторяет флаг подключения менеджера", async () => {
    expect(tappedButtonText("Каталог")).toBe("👉 Каталог");
    expect(tappedButtonText(undefined)).toBe("👉 нажал кнопку");

    const on = setup(true, true);
    expect(await inboundIntercepted(on.ctx, 7, tappedButtonText("Каталог"))).toBe(true);
    expect(on.db.tables.manager_chat_messages).toMatchObject([
      { telegram_id: 7, direction: "in", sender: "customer", text: "👉 Каталог" },
    ]);
    expect(on.db.tables.manager_chat_state![0]!.unread_count).toBe(1);

    const off = setup(true, false);
    expect(await inboundIntercepted(off.ctx, 7, tappedButtonText("Каталог"))).toBe(false);
    expect(off.db.tables.manager_chat_messages).toHaveLength(1);
  });
});

describe("подключение менеджера — пауза, а не навсегда", () => {
  const H = 3600_000;
  const now = Date.parse("2026-10-31T14:00:00Z");
  function connected(o: {
    hoursAgo: number;
    pauseHours?: number;
    pausedUntil?: string;
    connectedAt?: string | null;
  }) {
    const s = setup(true, true);
    const at =
      o.connectedAt === undefined ? new Date(now - o.hoursAgo * H).toISOString() : o.connectedAt;
    s.db.tables.manager_chat_state![0]!.connected_at = at;
    s.db.tables.bot_users = [
      {
        bot_id: BOT,
        telegram_id: 7,
        user_key: "wa:7",
        state: o.pausedUntil ? { consultant: { paused_until: o.pausedUntil } } : {},
        // fakeDb отдаёт строку целиком, без проекций: так PostgREST вернул бы
        // `paused_until:state->consultant->>paused_until`.
        paused_until: o.pausedUntil ?? null,
      },
    ];
    (s.ctx.tenant as { settings?: unknown }).settings =
      o.pauseHours === undefined ? {} : { consultant_pause_hours: o.pauseHours };
    return s;
  }

  it("передача 4 дня назад, менеджер молчит — снимается, в «Чате» диалог больше не «у менеджера»", async () => {
    const s = connected({ hoursAgo: 96 });
    expect(await isManagerConnected(s.ctx, 7, now)).toBe(false);
    expect(s.db.tables.manager_chat_state![0]!.active).toBe(false);
  });

  it("в пределах паузы (6 ч по умолчанию) — держится", async () => {
    const s = connected({ hoursAgo: 5 });
    expect(await isManagerConnected(s.ctx, 7, now)).toBe(true);
    expect(s.db.tables.manager_chat_state![0]!.active).toBe(true);
  });

  it("срок — из настройки продавца: 12 ч держит 10-часовую передачу, 3 ч — нет", async () => {
    expect(await isManagerConnected(connected({ hoursAgo: 10, pauseHours: 12 }).ctx, 7, now)).toBe(
      true,
    );
    expect(await isManagerConnected(connected({ hoursAgo: 4, pauseHours: 3 }).ctx, 7, now)).toBe(
      false,
    );
  });

  it("«пока не верну сам» (0) — не истекает", async () => {
    const s = connected({ hoursAgo: 500, pauseHours: 0 });
    expect(await isManagerConnected(s.ctx, 7, now)).toBe(true);
  });

  it("менеджер ответил недавно — пауза консультанта продлена, подключение держится", async () => {
    const s = connected({ hoursAgo: 48, pausedUntil: new Date(now + 2 * H).toISOString() });
    expect(await isManagerConnected(s.ctx, 7, now)).toBe(true);
    expect(s.db.tables.manager_chat_state![0]!.active).toBe(true);
  });

  it("строка без connected_at — срок неизвестен, держим как раньше", async () => {
    const s = connected({ hoursAgo: 0, connectedAt: null });
    expect(await isManagerConnected(s.ctx, 7, now)).toBe(true);
  });

  it("гонка: коллега подключился заново между чтением и снятием — его подключение не затирается", async () => {
    const s = connected({ hoursAgo: 96 });
    const fresh = new Date(now - 60_000).toISOString();
    const from = s.db.from.bind(s.db);
    let reads = 0;
    s.db.from = ((t: string) => {
      if (t === "manager_chat_state" && ++reads === 2)
        s.db.tables.manager_chat_state![0]!.connected_at = fresh;
      return from(t as never);
    }) as typeof s.db.from;
    expect(await isManagerConnected(s.ctx, 7, now)).toBe(true);
    expect(s.db.tables.manager_chat_state![0]).toMatchObject({ active: true, connected_at: fresh });
  });
});

describe("окно 24 часа: последнее входящее", () => {
  it("берётся последнее входящее покупателя; исходящие и чужие диалоги не считаются", async () => {
    const s = setup(true, false);
    const row = (telegram_id: number, direction: string, created_at: string, id: string) => ({
      id,
      bot_id: BOT,
      telegram_id,
      direction,
      sender: direction === "in" ? "customer" : "bot",
      text: "x",
      created_at,
    });
    s.db.tables.manager_chat_messages = [
      row(7, "in", "2026-09-26T10:00:00Z", "a"),
      row(7, "in", "2026-09-26T12:00:00Z", "b"),
      // Наши ответы окно не продлевают.
      row(7, "out", "2026-09-27T09:00:00Z", "c"),
      row(8, "in", "2026-09-27T11:00:00Z", "d"),
    ];
    expect(await lastInboundAt(s.ctx, 7)).toBe("2026-09-26T12:00:00Z");
    expect(await lastInboundAt(s.ctx, 9)).toBeNull();
  });
});

describe("страницы переписки", () => {
  const msg = (n: number, tg = 7) => ({
    id: `m-${String(n).padStart(5, "0")}`,
    bot_id: BOT,
    telegram_id: tg,
    direction: "in",
    sender: "customer",
    text: `текст ${n}`,
    // По 4 сообщения на одну секунду: граница страницы часто падает внутрь одинакового created_at.
    created_at: new Date(Date.UTC(2026, 0, 1) + Math.floor(n / 4) * 1000).toISOString(),
  });

  it("1200 сообщений: страницы без пропусков и повторов, чужой диалог не виден", async () => {
    const s = setup(true, false);
    s.db.tables.manager_chat_messages = [
      ...Array.from({ length: 1200 }, (_, i) => msg(i)),
      msg(5000, 8),
    ];
    const seen: string[] = [];
    let page = await listMessages(s.ctx, 7, { limit: 200 });
    expect(page.messages).toHaveLength(200);
    expect(page.messages[199]!.id).toBe("m-01199");
    let pages = 0;
    for (;;) {
      pages++;
      seen.unshift(...page.messages.map((m) => m.id));
      if (!page.hasMore) break;
      const first = page.messages[0]!;
      page = await listMessages(s.ctx, 7, {
        limit: 200,
        before: { created_at: first.created_at, id: first.id },
      });
    }
    expect(pages).toBe(6);
    expect(seen).toHaveLength(1200);
    expect(new Set(seen).size).toBe(1200);
    expect(seen).toEqual(Array.from({ length: 1200 }, (_, i) => `m-${String(i).padStart(5, "0")}`));
  });

  it("ровно одна страница — «раньше» нет; пустой диалог — пусто", async () => {
    const s = setup(true, false);
    s.db.tables.manager_chat_messages = Array.from({ length: 200 }, (_, i) => msg(i));
    expect((await listMessages(s.ctx, 7, { limit: 200 })).hasMore).toBe(false);
    expect(await listMessages(s.ctx, 99)).toEqual({ messages: [], hasMore: false });
  });

  it("склейка опроса с подгруженной историей: по id, в порядке времени", () => {
    const m = (n: number) => ({ ...msg(n), id: `m-${n}` });
    const merged = mergeMessages([m(1), m(2), m(3)].map(strip), [m(3), m(4)].map(strip));
    expect(merged.map((x) => x.id)).toEqual(["m-1", "m-2", "m-3", "m-4"]);
  });
});

function strip(m: {
  id: string;
  direction: string;
  sender: string;
  text: string;
  created_at: string;
}) {
  return {
    id: m.id,
    direction: m.direction,
    sender: m.sender,
    text: m.text,
    created_at: m.created_at,
  } as never;
}
