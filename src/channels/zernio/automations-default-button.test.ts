import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { COPY } from "@/channels/telegram/copy";
import { handleCommentReceived, type AutomationApi } from "./automations.server";

/** Н5: кнопка Comment-to-DM по умолчанию — на языке магазина, не только по-русски. */
const BOT = "22222222-2222-2222-2222-222222222222";

async function run(locale: string) {
  const db = fakeDb();
  db.tables.app_settings = [
    {
      bot_id: BOT,
      key: "ig_comment_automations_meta",
      value: JSON.stringify({ rule1: { twoStepDm: true, secondDmMessage: "Держите" } }),
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
        default_locale: locale,
        zernio: { profile_id: "p-1", accounts: [{ id: "acc-1", platform: "instagram" }] },
        telegram: { username: "shop_bot" },
      },
      modules: { instagram: true },
    },
    db,
  } as unknown as TenantContext;
  const inbox = vi.fn(async () => ({ ok: true }));
  const api = {
    list: async () => [
      { id: "rule1", name: "Хочу", accountId: "acc-1", keywords: ["хочу"], dmMessage: "Привет" },
    ],
    inbox,
  } as unknown as AutomationApi;
  await handleCommentReceived(
    ctx,
    {
      account: { id: "acc-1" },
      comment: { id: "c-1", text: "Хочу!", author: { id: "u-1", username: "Anya" } },
    },
    api,
    { delayMs: 0 },
  );
  return inbox.mock.calls[0] as unknown as [string, string, string, { buttons: unknown[] }];
}

describe("кнопка Comment-to-DM по умолчанию", () => {
  it("на языке магазина и не длиннее 20 знаков (иначе Instagram её обрежет)", async () => {
    for (const l of ["ru", "kk", "en", "uz"] as const) {
      const title = COPY[l].openTelegramBtn;
      expect([...title].length).toBeLessThanOrEqual(20);
      expect((await run(l))[3].buttons).toEqual([
        { type: "url", title, url: "https://t.me/shop_bot" },
      ]);
    }
    expect(COPY.kk.openTelegramBtn).not.toBe(COPY.ru.openTelegramBtn);
  });
});
