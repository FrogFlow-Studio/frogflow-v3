import { describe, expect, it } from "vitest";
import {
  dayStats,
  flagId,
  journalEntries,
  lastLocalDays,
  runOutcome,
  workspaceAlerts,
  type JournalRow,
} from "./journal";

/** Журнал ответов консультанта для продавца (партия 3.4) и предупреждения «Обзора» (3.5). */
const row = (over: Partial<JournalRow>): JournalRow => ({
  id: "r1",
  conversation_id: "c1",
  status: "replied",
  incoming_text: "Есть полотенца?",
  reply_text: "Есть.",
  reply_kind: "reply",
  received_at: "2026-10-08T05:00:00Z",
  ...over,
});
const CATALOG = [
  {
    id: "T1",
    name: "Uchino полотенце банное",
    category: "Полотенца",
    size: "50x100",
    colors: ["белый"],
    price_kzt: 9000,
    stock: true,
  },
];

describe("журнал ответов консультанта", () => {
  it("исход хода: ответ, передача с причиной, молчание с причиной, сбой отправки", () => {
    expect(runOutcome(row({}))).toEqual({ kind: "replied" });
    expect(runOutcome(row({ reply_kind: "handoff:purchase" }))).toEqual({
      kind: "handoff",
      reason: "purchase",
    });
    expect(runOutcome(row({ status: "cancelled", reply_kind: "manager" }))).toEqual({
      kind: "silent",
      why: "manager",
    });
    expect(runOutcome(row({ status: "cancelled", reply_kind: "что-то" }))).toEqual({
      kind: "silent",
      why: "other",
    });
    expect(runOutcome(row({ status: "terminal_failed" }))).toEqual({ kind: "failed" });
  });

  it("замечания — те же проверки, что в сводке качества; приветствие не в первом ответе", () => {
    const rows = [
      row({ id: "a", received_at: "2026-10-08T05:00:00Z", reply_text: "Здравствуйте! Есть." }),
      row({
        id: "b",
        received_at: "2026-10-08T05:05:00Z",
        reply_text:
          "Здравствуйте, Uchino полотенце банное 50x100 - 5 000 ₸. Какой цвет? Какой размер?",
      }),
      row({ id: "c", status: "cancelled", reply_kind: "paused", reply_text: null }),
    ];
    const byId = Object.fromEntries(journalEntries(rows, CATALOG).map((e) => [e.id, e]));
    expect(byId.b!.flags).toEqual(expect.arrayContaining(["price", "questions", "greeting"]));
    expect(byId.a!.flags).not.toContain("greeting");
    expect(byId.c!.flags).toEqual([]);
    expect(byId.c!.outcome).toEqual({ kind: "silent", why: "paused" });
    expect(flagId("неизвестная")).toBe("other");
  });

  it("счёт по дням магазина: диалоги, ответы, передачи; пустой день — нули", () => {
    const days = lastLocalDays(new Date("2026-10-08T20:00:00Z"), "Asia/Almaty", 3);
    // 20:00 UTC — уже 9 октября в Алматы.
    expect(days).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
    const stats = dayStats(
      [
        row({ id: "1", conversation_id: "x", received_at: "2026-10-08T03:00:00Z" }),
        row({
          id: "2",
          conversation_id: "x",
          reply_kind: "handoff:wholesale",
          received_at: "2026-10-08T04:00:00Z",
        }),
        row({
          id: "3",
          conversation_id: "y",
          status: "cancelled",
          reply_kind: "paused",
          received_at: "2026-10-08T05:00:00Z",
        }),
        // Вошло в соседний ответ — не «без ответа».
        row({
          id: "4",
          conversation_id: "y",
          status: "cancelled",
          reply_kind: "folded",
          received_at: "2026-10-08T05:00:01Z",
        }),
      ],
      "Asia/Almaty",
      days,
    );
    expect(stats).toEqual([
      { date: "2026-10-07", dialogs: 0, replies: 0, handoffs: 0, silent: 0 },
      { date: "2026-10-08", dialogs: 2, replies: 2, handoffs: 1, silent: 1 },
      { date: "2026-10-09", dialogs: 0, replies: 0, handoffs: 0, silent: 0 },
    ]);
  });
});

describe("предупреждения «Обзора» консультанта", () => {
  const base = {
    enabled: true,
    pricelistCount: 10,
    pricelistAt: "2026-10-07T00:00:00Z",
    sheetFailing: false,
    rate: { fresh: true },
    spentUsd: 1,
    limitUsd: 5,
    lastError: "",
    chatOn: true,
    untaggedArticles: 0,
  };
  const now = Date.parse("2026-10-08T10:00:00Z");
  it("всё в порядке — предупреждений нет", () => {
    expect(workspaceAlerts(base, now)).toEqual([]);
  });
  it("прайс устарел, курса нет, предел близко, модель сбоит, чат выключен", () => {
    const keys = workspaceAlerts(
      {
        ...base,
        pricelistAt: "2026-09-21T00:00:00Z",
        rate: null,
        spentUsd: 4.2,
        lastError: "2026-10-08T09:00:00.000Z — Anthropic 529",
        chatOn: false,
        untaggedArticles: 2,
      },
      now,
    );
    expect(keys.map((a) => a.key)).toEqual([
      "pricelistStale",
      "rateNone",
      "limitNear",
      "modelFailing",
      "chatOff",
      "untaggedArticles",
    ]);
    expect(keys[0]).toMatchObject({ days: 17 });
    expect(keys[3]).toMatchObject({ error: "Anthropic 529" });
  });
  it("старая ошибка модели и исчерпанный предел", () => {
    const keys = workspaceAlerts(
      { ...base, spentUsd: 5, lastError: "2026-10-01T00:00:00.000Z — старое" },
      now,
    ).map((a) => a.key);
    expect(keys).toEqual(["limitReached"]);
  });
});
