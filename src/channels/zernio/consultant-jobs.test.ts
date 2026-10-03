import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../tests/fake-db";
import type { TenantContext } from "@/core/tenant/resolve.server";
import { settingsFromJson } from "@/core/tenant/directory";
import { sendPricelistFollowUps } from "./consultant-jobs.server";
import type { ZernioTransport } from "./api.server";

/**
 * Напоминание замолчавшему покупателю (шаг 16 переноса BOVI): одно на
 * паузу, в окне Instagram, свой голос запоминается — проверка «в чате
 * менеджер» не примет напоминание за человека.
 */
const now = new Date("2026-09-25T08:00:00Z"); // 13:00 по Алматы
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

function ctxOf(followUp = "on"): TenantContext {
  const db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [
    { bot_id: "b1", key: "consultant_followup", value: followUp },
    {
      bot_id: "b1",
      key: "consultant_catalog_json",
      value: JSON.stringify([
        {
          id: "zt",
          name: "Uchino Полотенце махровое Zero Twist, 70x140, цвет белый",
          category: "Полотенца",
          size: "70x140",
          colors: ["белый"],
          price_kzt: 55000,
          stock: true,
        },
      ]),
    },
  ];
  const consultant = {
    recent: [
      { role: "customer", text: "Сколько Zero Twist?" },
      { role: "assistant", text: "55 000 ₸." },
    ],
    last_product_ids: ["zt"],
    last_reply_at: hoursAgo(4),
  };
  db.tables.bot_users = [
    {
      bot_id: "b1",
      user_key: "ig_1",
      platform: "instagram",
      telegram_id: -1,
      zernio_conversation_id: "conv1",
      zernio_account_id: "acc1",
      updated_at: hoursAgo(4),
      state: { consultant },
    },
    {
      bot_id: "b1",
      user_key: "ig_2",
      platform: "instagram",
      telegram_id: -2,
      zernio_conversation_id: "conv2",
      zernio_account_id: "acc1",
      updated_at: hoursAgo(1),
      state: { consultant: { ...consultant, last_reply_at: hoursAgo(1) } },
    },
  ];
  return {
    tenant: {
      id: `b1-${Math.random()}`,
      settings: settingsFromJson({ consultant_pricelist: { enabled: true } }),
      modules: {},
    },
    db,
    timezone: "Asia/Almaty",
  } as unknown as TenantContext;
}

const transport = () => {
  const send = vi.fn(async () => ({ ok: true as const }));
  return { t: { send } as unknown as ZernioTransport, send };
};
const consultantOf = (ctx: TenantContext, key: string) =>
  (
    (
      ctx.db as unknown as { tables: Record<string, Array<Record<string, unknown>>> }
    ).tables.bot_users!.find((r) => r.user_key === key)!.state as {
      consultant: Record<string, unknown>;
    }
  ).consultant;

describe("напоминание замолчавшему покупателю", () => {
  it("тишина 4 часа после ответа с товаром — одно напоминание, второй крон не повторяет", async () => {
    const ctx = ctxOf();
    const { t, send } = transport();
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      "conv1",
      "acc1",
      "Остались вопросы по Uchino Полотенце махровое Zero Twist? Подскажу по размеру, цвету или доставке.",
      expect.objectContaining({ platform: "instagram" }),
    ]);
    const c = consultantOf(ctx, "ig_1");
    expect(c.relayed).toEqual([expect.stringContaining("Остались вопросы")]);
    expect((c.recent as { text: string }[]).at(-1)!.text).toContain("Остались вопросы");
    expect(await sendPricelistFollowUps(ctx, now, t)).toMatchObject({ sent: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("два крона одновременно — одно напоминание", async () => {
    const ctx = ctxOf();
    const { t, send } = transport();
    const [a, b] = await Promise.all([
      sendPricelistFollowUps(ctx, now, t),
      sendPricelistFollowUps(ctx, now, t),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it("выключено у продавца или ночью — не пишем", async () => {
    const { t, send } = transport();
    expect(await sendPricelistFollowUps(ctxOf("off"), now, t)).toMatchObject({ skipped: "off" });
    const night = new Date("2026-09-25T18:00:00Z"); // 23:00 по Алматы
    expect(await sendPricelistFollowUps(ctxOf(), night, t)).toMatchObject({
      skipped: "off_hours",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("сводка качества за сутки", () => {
  const morning = new Date("2026-09-26T04:30:00Z"); // 9:30 по Алматы
  const withRuns = (on: string) => {
    const ctx = ctxOf();
    const tables = (ctx.db as unknown as { tables: Record<string, Record<string, unknown>[]> })
      .tables;
    tables.app_settings!.push({ bot_id: "b1", key: "consultant_quality_digest", value: on });
    tables.consultant_message_runs = [
      {
        bot_id: "b1",
        message_id: "m1",
        conversation_id: "c1",
        incoming_text: "Цена?",
        reply_text: "Отличный выбор! Премиальные полотенца. Какой размер? Какой цвет?",
        reply_kind: "reply",
        status: "replied",
        model: "claude-haiku-4-5",
        token_usage: { usd: 0.01 },
        received_at: "2026-09-25T08:00:00.000Z",
      },
    ];
    return ctx;
  };

  it("утром — сводка за вчера продавцу, один раз в сутки", async () => {
    const ctx = withRuns("on");
    const sent: string[] = [];
    const notify = async (_c: unknown, html: string) => (sent.push(html), 1);
    const { sendQualityDigest } = await import("./consultant-jobs.server");
    expect(await sendQualityDigest(ctx, morning, notify)).toEqual({ sent: true });
    expect(sent[0]).toContain("Консультант за 25.09");
    expect(sent[0]).toContain("рекламные слова");
    expect(await sendQualityDigest(ctx, morning, notify)).toMatchObject({ reason: "already" });
    expect(sent).toHaveLength(1);
  });

  it("два крона одновременно — одна сводка", async () => {
    const ctx = withRuns("on");
    const sent: string[] = [];
    const notify = async (_c: unknown, html: string) => {
      await new Promise((r) => setTimeout(r, 5));
      sent.push(html);
      return 1;
    };
    const { sendQualityDigest } = await import("./consultant-jobs.server");
    await Promise.all([
      sendQualityDigest(ctx, morning, notify),
      sendQualityDigest(ctx, morning, notify),
    ]);
    expect(sent).toHaveLength(1);
  });

  it("выключена или рано — не шлём", async () => {
    const { sendQualityDigest } = await import("./consultant-jobs.server");
    const notify = vi.fn(async () => 1);
    expect(await sendQualityDigest(withRuns("off"), morning, notify)).toMatchObject({
      reason: "off",
    });
    expect(
      await sendQualityDigest(withRuns("on"), new Date("2026-09-26T02:00:00Z"), notify),
    ).toMatchObject({ reason: "early" });
    expect(notify).not.toHaveBeenCalled();
  });
});
