import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { handleCommentReceived, type AutomationApi } from "./automations.server";

const BOT = "22222222-2222-2222-2222-222222222222";

function setup() {
  const db = fakeDb();
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "ig_comment_automations_meta",
      value: JSON.stringify({
        rule1: {
          twoStepDm: true,
          secondDmMessage: "Держите материалы",
          secondDmButtons: [
            { type: "url", title: "Открыть бота", url: "https://t.me/seller_bot" },
            { type: "postback", title: "Каталог", payload: "CATALOG" },
          ],
        },
      }),
    },
  ];
  db.tables.bot_users = [
    { bot_id: BOT, platform: "instagram", username: "anya", zernio_conversation_id: "conv-1" },
  ];
  db.tables.zernio_logs = [];
  const ctx = {
    tenant: {
      id: BOT,
      settings: {
        zernio: { profile_id: "p-1", accounts: [{ id: "acc-1", platform: "instagram" }] },
        telegram: { username: "platform_default_bot" },
      },
      modules: { instagram: true },
    },
    db,
  } as unknown as TenantContext;
  const inbox = vi.fn(async () => ({ ok: true }));
  const api = {
    list: async () => [
      {
        id: "rule1",
        name: "Хочу",
        accountId: "acc-1",
        keywords: ["хочу"],
        dmMessage: "Привет! Сейчас пришлю",
        // Кнопки первого сообщения у самого правила Zernio — не те, что задал продавец для второго.
        buttons: [{ type: "url", title: "Zernio", url: "https://zernio.example" }],
      },
    ],
    inbox,
    startDirect: vi.fn(async () => ({ ok: false, error: "не нужно" })),
  } as unknown as AutomationApi;
  return { ctx, api, inbox, db };
}

describe("Comment-to-DM: второе сообщение с кнопками продавца", () => {
  it("уходят именно кнопки, которые продавец задал для второго сообщения", async () => {
    const { ctx, api, inbox, db } = setup();
    const r = await handleCommentReceived(
      ctx,
      {
        account: { id: "acc-1" },
        comment: { id: "c-1", text: "Хочу!", author: { id: "u-1", username: "Anya" } },
      },
      api,
      { delayMs: 0 },
    );
    expect(r.note).toBe("второе сообщение @Anya");
    expect(inbox).toHaveBeenCalledWith("conv-1", "acc-1", "Держите материалы", {
      buttons: [
        { type: "url", title: "Открыть бота", url: "https://t.me/seller_bot" },
        { type: "postback", title: "Каталог", payload: "CATALOG" },
      ],
      platform: "instagram",
    });
    expect(db.tables.zernio_logs!.map((l) => [l.event_id, l.status])).toEqual([
      ["two-step-dm:c-1", "processed"],
    ]);
  });
});
