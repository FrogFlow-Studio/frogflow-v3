import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { ServerFailure } from "@/lib/server-failure";
import type { Conversation } from "@/core/chat/chat";
import {
  channelOf,
  claimInbox,
  claimOnReply,
  cleanQuickReplies,
  fillQuickReply,
  matchesInbox,
  inboxEventId,
  mergeInbox,
  parseQuickReplies,
  rowToMeta,
  QUICK_REPLIES_MAX,
  type InboxFilter,
  type InboxMeta,
} from "./inbox";

const conv = (id: number, over: Partial<Conversation> = {}): Conversation => ({
  telegram_id: id,
  active: false,
  last_message_at: "2026-09-26T10:00:00Z",
  last_message_preview: "привет",
  last_message_direction: "in",
  unread_count: 0,
  username: null,
  first_name: null,
  last_name: null,
  platform: "telegram",
  user_key: null,
  bot_paused_until: null,
  ...over,
});

const meta = (id: number, over: Partial<InboxMeta> = {}): InboxMeta => ({
  telegramId: id,
  status: "open",
  assignee: null,
  updatedAt: null,
  updatedBy: null,
  ...over,
});

const ALL: InboxFilter = { status: "all", who: "all", channel: "all" };

describe("единый входящий", () => {
  it("ключ строки включает бота: event_id уникален на всю базу", () => {
    expect(inboxEventId("bot-a", 5)).toBe("inbox:bot-a:5");
    expect(inboxEventId("bot-a", -7)).not.toBe(inboxEventId("bot-b", -7));
  });

  it("строка базы → учёт: неизвестный статус считается открытым, пустой ответственный — null", () => {
    expect(rowToMeta({ status: "closed", payload: { telegram_id: 3, assignee: "anna" } })).toEqual({
      telegramId: 3,
      status: "closed",
      assignee: "anna",
      updatedAt: null,
      updatedBy: null,
    });
    expect(
      rowToMeta({ status: "pending", payload: { telegram_id: 3, assignee: "" } }),
    ).toMatchObject({ status: "open", assignee: null });
    expect(rowToMeta({ status: "open", payload: null })).toMatchObject({ telegramId: 0 });
  });

  it("канал: всё, что не Instagram и не WhatsApp, — Telegram", () => {
    expect(channelOf("instagram")).toBe("instagram");
    expect(channelOf("whatsapp")).toBe("whatsapp");
    expect(channelOf("telegram")).toBe("telegram");
    expect(channelOf(null)).toBe("telegram");
  });

  it("диалог без строки учёта — открыт и ничей; номера обращений подставляются", () => {
    const items = mergeInbox(
      [conv(1), conv(2)],
      new Map([[2, meta(2, { status: "closed", assignee: "anna" })]]),
      new Map([[1, [7, 9]]]),
    );
    expect(items[0]).toMatchObject({
      telegram_id: 1,
      status: "open",
      assignee: null,
      tickets: [7, 9],
    });
    expect(items[1]).toMatchObject({
      telegram_id: 2,
      status: "closed",
      assignee: "anna",
      tickets: [],
    });
  });

  const items = mergeInbox(
    [
      conv(1, { platform: "instagram" }),
      conv(2, { unread_count: 3 }),
      conv(3, { platform: "whatsapp", unread_count: 1 }),
      conv(4),
    ],
    new Map([
      [1, meta(1, { assignee: "anna" })],
      [3, meta(3, { status: "closed", assignee: "boris" })],
      [4, meta(4, { assignee: "boris" })],
    ]),
  );
  const ids = (f: Partial<InboxFilter>, me = "boris") =>
    items.filter((i) => matchesInbox(i, { ...ALL, ...f }, me)).map((i) => i.telegram_id);

  it("фильтры: статус, «мои», «без ответственного», канал", () => {
    expect(ids({ status: "open" })).toEqual([1, 2, 4]);
    expect(ids({ status: "closed" })).toEqual([3]);
    expect(ids({ who: "mine" })).toEqual([3, 4]);
    expect(ids({ who: "mine", status: "open" })).toEqual([4]);
    expect(ids({ who: "none" })).toEqual([2]);
    expect(ids({ channel: "instagram" })).toEqual([1]);
    expect(ids({ channel: "telegram" })).toEqual([2, 4]);
  });

  it("непрочитанные и поиск по имени и @username без учёта регистра", () => {
    expect(ids({ unread: true })).toEqual([2, 3]);
    const named = [
      { ...items[0]!, first_name: "Анна", last_name: "Иванова", username: "anna_i" },
      { ...items[1]!, first_name: "Борис", username: null },
    ];
    const hit = (search: string) =>
      named.filter((i) => matchesInbox(i, { ...ALL, search }, "")).map((i) => i.telegram_id);
    expect(hit("анна ив")).toEqual([1]);
    expect(hit("@ANNA_I")).toEqual([1]);
    expect(hit("  бор ")).toEqual([2]);
    expect(hit("")).toEqual([1, 2]);
    expect(hit("нет такого")).toEqual([]);
  });
});

describe("быстрые ответы", () => {
  it("битый или чужой JSON в настройке — пустой список, а не падение страницы", () => {
    expect(parseQuickReplies(null)).toEqual([]);
    expect(parseQuickReplies("не json")).toEqual([]);
    expect(parseQuickReplies('{"a":1}')).toEqual([]);
    expect(parseQuickReplies('[{"title":"Цена","text":"от 5000 ₸"}]')).toEqual([
      { title: "Цена", text: "от 5000 ₸" },
    ]);
  });

  it("пустые выкидываются, без названия — первая строка текста, длины и число ограничены", () => {
    const r = cleanQuickReplies([
      { title: "  ", text: "  " },
      { title: "", text: "Доставка завтра\nс 10 до 18" },
      { title: "x".repeat(100), text: "y".repeat(3000) },
      { text: 42 as unknown as string },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ title: "Доставка завтра", text: "Доставка завтра\nс 10 до 18" });
    expect(r[1]!.title).toHaveLength(60);
    expect(r[1]!.text).toHaveLength(2000);
    const many = Array.from({ length: 50 }, (_, i) => ({ title: `t${i}`, text: `x${i}` }));
    expect(cleanQuickReplies(many)).toHaveLength(QUICK_REPLIES_MAX);
  });

  it("{name} — имя покупателя; без имени обращение убирается аккуратно", () => {
    expect(fillQuickReply("Здравствуйте, {name}!", { first_name: "Анна" })).toBe(
      "Здравствуйте, Анна!",
    );
    expect(fillQuickReply("Здравствуйте, {name}!", { first_name: null })).toBe("Здравствуйте!");
    expect(fillQuickReply("{name}, спасибо", { first_name: " " })).toBe("спасибо");
    expect(fillQuickReply("Привет {name} как дела", { first_name: null })).toBe("Привет как дела");
  });

  it("{order} и {ticket} — номера с «№»; чего нет, убирается вместе с пробелом перед ним", () => {
    const vars = { first_name: "Анна", orderNo: 128, ticketNo: 7 };
    expect(fillQuickReply("{name}, заказ {order} уже едет (обращение {ticket}).", vars)).toBe(
      "Анна, заказ №128 уже едет (обращение №7).",
    );
    expect(
      fillQuickReply("{name}, заказ {order} уже едет (обращение {ticket}).", {
        first_name: "Анна",
      }),
    ).toBe("Анна, заказ уже едет (обращение).");
    expect(fillQuickReply("Заказ {order}, {order}", { first_name: null, orderNo: 5 })).toBe(
      "Заказ №5, №5",
    );
  });
});

describe("Д1: два менеджера отвечают в ничьём диалоге", () => {
  const BOT = "11111111-1111-1111-1111-111111111111";
  const mk = () => {
    const db = fakeDb({ unique: { zernio_logs: [["event_id"]] } });
    db.tables.zernio_logs = [];
    return { db, ctx: { tenant: { id: BOT }, db } as unknown as TenantContext };
  };

  it("одновременные первые ответы: один ответственный, оба без ошибки", async () => {
    const { db, ctx } = mk();
    const [a, b] = await Promise.all([
      claimOnReply(ctx, 5, "anna", "anna"),
      claimOnReply(ctx, 5, "boris", "boris"),
    ]);
    expect([a, b]).toEqual([undefined, undefined]);
    const rows = db.tables.zernio_logs!;
    expect(rows).toHaveLength(1);
    expect(["anna", "boris"]).toContain((rows[0]!.payload as { assignee: string }).assignee);
  });

  it("claimInbox: проигравший получает false и не затирает ответственного", async () => {
    const { db, ctx } = mk();
    expect(await claimInbox(ctx, 5, "anna", "anna")).toBe(true);
    expect(await claimInbox(ctx, 5, "boris", "boris")).toBe(false);
    expect((db.tables.zernio_logs![0]!.payload as { assignee: string }).assignee).toBe("anna");
  });

  it("строка есть, но ничья (решён без ответственного): забирает первый, статус не меняется", async () => {
    const { db, ctx } = mk();
    db.tables.zernio_logs = [
      {
        bot_id: BOT,
        event_id: inboxEventId(BOT, 5),
        event_type: "inbox",
        status: "closed",
        payload: { telegram_id: 5, assignee: null },
      },
    ];
    const [a, b] = await Promise.all([
      claimInbox(ctx, 5, "anna", "anna"),
      claimInbox(ctx, 5, "boris", "boris"),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(db.tables.zernio_logs![0]!.status).toBe("closed");
  });

  it("сбой базы при закреплении не роняет ответ, но claimInbox его не прячет", async () => {
    const { ctx } = mk();
    const broken = {
      tenant: ctx.tenant,
      db: { from: () => ({ insert: async () => ({ error: { code: "XX000", message: "boom" } }) }) },
    } as unknown as TenantContext;
    await expect(claimOnReply(broken, 5, "anna", "anna")).resolves.toBeUndefined();
    await expect(claimInbox(broken, 5, "anna", "anna")).rejects.toBeInstanceOf(ServerFailure);
  });
});
