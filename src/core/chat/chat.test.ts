import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { inboundIntercepted, inboundLogText, tappedButtonText } from "./chat";

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
