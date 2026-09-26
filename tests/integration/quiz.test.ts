import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveReady, DEMO_BOT, TEST_TG_ID } from "./live";
import { serviceDb } from "@/core/db/client.server";
import { requireTenant, tenantContext, type TenantContext } from "@/core/tenant/resolve.server";
import { upsertCustomer } from "@/core/customers/customers";
import { getSetting, setSetting } from "@/core/settings/settings";
import { QUIZ_KEY } from "@/core/quiz/quiz";
import { handleTelegramUpdate } from "@/channels/telegram/handle-update";
import type { TelegramApi } from "@/channels/telegram/api";

/** Квиз в боте: ответ на вопрос кнопкой → подбор с кнопкой на подходящий товар. */
const TG = TEST_TG_ID + 98;
let ctx: TenantContext;
let prev: string | null = null;
let productId = "";
const calls: Array<[string, Record<string, unknown>]> = [];
const api = {
  call: async (method: string, payload: unknown = {}) => {
    calls.push([method, payload as Record<string, unknown>]);
    return { ok: true, result: {} as never };
  },
  fileUrl: () => "",
} as unknown as TelegramApi;

describe.skipIf(!liveReady)("квиз-подбор в боте на демо-клиенте", () => {
  beforeAll(async () => {
    const t = await requireTenant({ by: "id", value: DEMO_BOT });
    ctx = tenantContext({ ...t, status: "active", modules: { ...t.modules, quiz: true } });
    prev = await getSetting(ctx, QUIZ_KEY);
    const { data, error } = await ctx.db
      .from("products")
      .insert({
        bot_id: DEMO_BOT,
        name: "v2 quiz · космический набор",
        keywords: "космос, ракета",
        price: 100,
        currency: "KZT",
        is_active: true,
        fulfillment_kind: "physical",
        category_ids: [],
        country_prices: {},
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message);
    productId = data.id;
    await setSetting(
      ctx,
      QUIZ_KEY,
      JSON.stringify({
        intro: "",
        questions: [
          {
            text: "Что интересно?",
            options: [
              { label: "Космос", tags: ["космос"] },
              { label: "Море", tags: ["море"] },
            ],
          },
        ],
      }),
    );
    await upsertCustomer(ctx, "telegram", String(TG), { firstName: "Квиз" });
  });
  afterAll(async () => {
    await setSetting(ctx, QUIZ_KEY, prev ?? "");
    const db = serviceDb();
    await db.from("products").delete().eq("id", productId);
    await db.from("bot_users").delete().eq("bot_id", DEMO_BOT).eq("telegram_id", TG);
  });

  it("вариант «Космос» приводит к товару с ключевым словом «космос»", async () => {
    await handleTelegramUpdate(ctx, api, {
      callback_query: {
        id: "cq1",
        data: "quiz:0:0",
        from: { id: TG },
        message: { chat: { id: TG }, message_id: 1 },
      },
    });
    const result = calls.find(
      ([m, p]) =>
        m === "sendMessage" && JSON.stringify(p.reply_markup ?? "").includes(`prod:${productId}`),
    );
    expect(result).toBeTruthy();
  });
});
