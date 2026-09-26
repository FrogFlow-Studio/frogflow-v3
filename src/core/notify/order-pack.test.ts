import { describe, expect, it } from "vitest";
import {
  isAdminNotifyStale,
  ADMIN_NOTIFY_DISMISS_DELAY_MS,
  adminNotifySettingKey,
  collectTgMessageIds,
  isAdminNotifyDue,
  isAdminNotifySettingKey,
  mergeAdminNotifyRefs,
  parseAdminNotifyPack,
  parseAdminNotifyRefs,
} from "./order-pack";

describe("уведомления продавцу о заказе: пачка сообщений", () => {
  it("парсит сохранённые message_id и отбрасывает мусор", () => {
    expect(parseAdminNotifyRefs(undefined)).toEqual([]);
    expect(parseAdminNotifyRefs("not-json")).toEqual([]);
    expect(
      parseAdminNotifyRefs(
        JSON.stringify([
          { chat_id: "100", message_id: 12 },
          { chat_id: 100, message_id: 13 },
          { chat_id: "100" },
        ]),
      ),
    ).toEqual([{ chat_id: "100", message_id: 12 }]);
  });

  it("читает пачку с отложенным удалением и старый массив", () => {
    expect(
      parseAdminNotifyPack(
        JSON.stringify({
          refs: [{ chat_id: "1", message_id: 9, buttons: true }],
          deleteAfter: "2026-09-02T08:25:00.000Z",
        }),
      ),
    ).toEqual({
      refs: [{ chat_id: "1", message_id: 9, buttons: true }],
      deleteAfter: "2026-09-02T08:25:00.000Z",
    });
    expect(parseAdminNotifyPack(JSON.stringify([{ chat_id: "1", message_id: 9 }]))).toEqual({
      refs: [{ chat_id: "1", message_id: 9 }],
      deleteAfter: null,
    });
  });

  it("считает пачку готовой к удалению только после deleteAfter", () => {
    const pack = {
      refs: [{ chat_id: "1", message_id: 1 }],
      deleteAfter: "2026-09-02T08:25:00.000Z",
    };
    expect(isAdminNotifyDue(pack, Date.parse("2026-09-02T08:24:59.000Z"))).toBe(false);
    expect(isAdminNotifyDue(pack, Date.parse("2026-09-02T08:25:00.000Z"))).toBe(true);
    expect(isAdminNotifyDue({ refs: [], deleteAfter: null })).toBe(false);
    expect(ADMIN_NOTIFY_DISMISS_DELAY_MS).toBe(5 * 60 * 1000);
  });

  it("достаёт id из одного сообщения и из media group", () => {
    expect(collectTgMessageIds({ message_id: 7 })).toEqual([7]);
    expect(collectTgMessageIds([{ message_id: 1 }, { message_id: 2 }])).toEqual([1, 2]);
    expect(collectTgMessageIds({ ok: true })).toEqual([]);
  });

  it("не дублирует одни и те же сообщения и сохраняет флаг кнопок", () => {
    expect(
      mergeAdminNotifyRefs(
        [{ chat_id: "1", message_id: 10, buttons: true }],
        [
          { chat_id: "1", message_id: 10 },
          { chat_id: "1", message_id: 11 },
        ],
      ),
    ).toEqual([
      { chat_id: "1", message_id: 10, buttons: true },
      { chat_id: "1", message_id: 11 },
    ]);
  });

  it("ключ свой, не v1: минутный крон v1 чужие пачки не трогает", () => {
    // v1 ищет «admin_notify_tg:*» по всей таблице, без bot_id, и удаляет
    // найденное своим токеном. Пачки v2 лежат под другим префиксом.
    expect(adminNotifySettingKey(42)).toBe("v2_order_notify:42");
    expect(adminNotifySettingKey(42).startsWith("admin_notify_tg:")).toBe(false);
    expect(isAdminNotifySettingKey("v2_order_notify:42")).toBe(true);
    expect(isAdminNotifySettingKey("admin_notify_tg:42")).toBe(false);
    expect(isAdminNotifySettingKey("admin_chat_id")).toBe(false);
  });

  it("пачка без решения старше недели — устаревшая, с решением или свежая — нет", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    const day = 24 * 3600_000;
    const old = new Date(now - 8 * day).toISOString();
    const fresh = new Date(now - 2 * day).toISOString();
    expect(isAdminNotifyStale({ refs: [], deleteAfter: null, createdAt: old }, null, now)).toBe(
      true,
    );
    expect(isAdminNotifyStale({ refs: [], deleteAfter: null, createdAt: fresh }, old, now)).toBe(
      false,
    );
    // Пачка, записанная до createdAt, — по времени строки.
    expect(isAdminNotifyStale({ refs: [], deleteAfter: null }, old, now)).toBe(true);
    expect(isAdminNotifyStale({ refs: [], deleteAfter: null }, null, now)).toBe(false);
    // С решением её уберёт обычная пятиминутная чистка.
    expect(isAdminNotifyStale({ refs: [], deleteAfter: old, createdAt: old }, old, now)).toBe(
      false,
    );
    expect(parseAdminNotifyPack(JSON.stringify({ refs: [], createdAt: old }))).toEqual({
      refs: [],
      deleteAfter: null,
      createdAt: old,
    });
  });
});
