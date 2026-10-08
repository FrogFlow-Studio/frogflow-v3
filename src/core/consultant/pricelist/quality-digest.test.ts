import { describe, expect, it } from "vitest";
import type { ConsultantProduct } from "./catalog";
import { buildQualityDigest, previousLocalDay, type DigestRun } from "./quality-digest";

/** Сводка качества за сутки: считает код, без модели (перенос тестов v1 без тени). */
const catalog: ConsultantProduct[] = [
  {
    id: "pip",
    name: "PIP Полотенце махровое Les Fleurs 55х100",
    category: "Полотенца",
    size: "55х100",
    colors: ["бежевый"],
    price_kzt: 15000,
    stock: true,
  },
];

const run = (over: Partial<DigestRun>): DigestRun => ({
  conversation_id: "c1",
  incoming_text: "Цена?",
  reply_text: "55х100 — 15 000 ₸. Какой размер нужен?",
  reply_kind: "reply",
  status: "replied",
  model: "claude-haiku-4-5-20251001",
  token_usage: { usd: 0.01 },
  ...over,
});

describe("сводка качества за сутки", () => {
  it("ответов не было — сводки нет", () => {
    expect(buildQualityDigest([], catalog, { day: "2026-09-24" })).toBeNull();
    expect(
      buildQualityDigest([run({ status: "cancelled", reply_text: null })], catalog, {
        day: "2026-09-24",
      }),
    ).toBeNull();
  });

  it("счёт ответов, передач, замечаний и расхода", () => {
    const text = buildQualityDigest(
      [
        run({}),
        run({
          conversation_id: "c2",
          reply_text: "Отличный выбор! Это премиальные полотенца. Какой размер? Какой цвет?",
        }),
        run({
          conversation_id: "c3",
          reply_kind: "handoff:wholesale",
          reply_text: "Опт ведёт менеджер.",
        }),
        run({ conversation_id: "c4", status: "cancelled", reply_text: null }),
        // Вошло в соседний ход (core/consultant/burst) — не «бот молчал при менеджере».
        run({
          conversation_id: "c4",
          status: "cancelled",
          reply_kind: "folded",
          reply_text: null,
          token_usage: {},
        }),
      ],
      catalog,
      { day: "2026-09-24" },
    )!;
    expect(text).toContain("за 24.09");
    expect(text).toContain("Диалогов: 4, ответов бота: 3.");
    expect(text).toContain("Передано менеджеру: 1, отвечал менеджер (бот молчал): 1.");
    expect(text).toContain("Ответы без замечаний: 2 из 3 (67%).");
    expect(text).toMatch(/Замечания: [^\n]*рекламные слова 1/);
    expect(text).toContain("Расход модели: $0.04");
    expect(text).toContain("Примеры:");
  });
});

describe("сутки по поясу магазина", () => {
  it("утром 26.09 по Алматы — сводка за 25.09", () => {
    expect(previousLocalDay(new Date("2026-09-26T04:30:00Z"), "Asia/Almaty")).toEqual({
      day: "2026-09-25",
      from: "2026-09-24T19:00:00.000Z",
      to: "2026-09-25T19:00:00.000Z",
      hour: 9,
    });
  });

  it("другой пояс — свои сутки", () => {
    expect(previousLocalDay(new Date("2026-09-26T08:00:00Z"), "Europe/Moscow")).toMatchObject({
      day: "2026-09-25",
      from: "2026-09-24T21:00:00.000Z",
      hour: 11,
    });
  });
});
