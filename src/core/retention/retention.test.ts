import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import { ServerFailure } from "@/lib/server-failure";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
let directory: Array<{ id: string; archived?: boolean; settings: Record<string, unknown> }> = [];
vi.mock("@/core/tenant/resolve.server", () => ({ tenantDirectory: async () => directory }));

const {
  RETENTION,
  pruneBroadcastRecipients,
  pruneCheckoutChallenges,
  pruneClosedLeads,
  pruneClosedMarketReports,
  pruneMarketEvents,
  pruneOperatorLoginAttempts,
  pruneReceiptChecks,
  pruneRateLimits,
  BATCH,
  pruneSignupChallenges,
  pruneZernioLogs,
  runRetention,
} = await import("./retention");

const NOW = Date.parse("2026-09-26T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

beforeEach(() => {
  db = fakeDb();
});

describe("сроки хранения служебных журналов, как в v1", () => {
  it("pruneOperatorAuditTables удаляет старые попытки входа оператора, свежие остаются", async () => {
    const old = RETENTION.operatorLoginsDays + 1;
    db.tables.operator_login_attempts = [
      { id: "old-1", at: daysAgo(old), username: "a", ok: false },
      { id: "old-2", at: daysAgo(old + 30), username: "a", ok: true },
      { id: "fresh", at: daysAgo(1), username: "a", ok: true },
    ];
    expect(await pruneOperatorLoginAttempts(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.operator_login_attempts!.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("pruneBroadcastRecipients удаляет получателей кампаний старше окна", async () => {
    const old = RETENTION.broadcastRecipientsDays + 1;
    db.tables.broadcasts = [
      { id: "b-old", bot_id: "bot-1", created_at: daysAgo(old) },
      { id: "b-new", bot_id: "bot-1", created_at: daysAgo(3) },
      { id: "b-other", bot_id: "bot-2", created_at: daysAgo(old) },
    ];
    db.tables.broadcast_recipients = [
      { id: "r1", broadcast_id: "b-old" },
      { id: "r2", broadcast_id: "b-old" },
      { id: "r3", broadcast_id: "b-new" },
      { id: "r4", broadcast_id: "b-other" },
    ];
    // Только клиенты из списка (на v2): кампания чужого клиента не трогается.
    expect(await pruneBroadcastRecipients(NOW, ["bot-1"])).toEqual({ deleted: 2, done: true });
    expect(db.tables.broadcast_recipients!.map((r) => r.id)).toEqual(["r3", "r4"]);
    // Сама кампания остаётся: чистятся только получатели.
    expect(db.tables.broadcasts!.map((b) => b.id)).toEqual(["b-old", "b-new", "b-other"]);
  });
});

describe("ретеншн zernio_logs", () => {
  beforeEach(() => {
    db.tables.zernio_logs = [];
  });

  it("сообщает done, когда удалять нечего", async () => {
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 0, done: true });
    db.tables.zernio_logs = [
      { id: "fresh", bot_id: "b", status: "processed", created_at: daysAgo(1) },
      { id: "recent-fail", bot_id: "b", status: "failed", created_at: daysAgo(40) },
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 0, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["fresh", "recent-fail"]);
  });

  it("убирает отработанное старше 30 дней и сбои старше 180, остальное оставляет", async () => {
    db.tables.zernio_logs = [
      { id: "old-ok", bot_id: "b", status: "processed", created_at: daysAgo(31) },
      { id: "old-fail", bot_id: "b", status: "failed", created_at: daysAgo(181) },
      { id: "recent-fail", bot_id: "b", status: "failed", created_at: daysAgo(40) },
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["recent-fail"]);
  });

  it("обращения helpdesk не удаляются, даже старые и незакрытые", async () => {
    db.tables.zernio_logs = [
      {
        id: "old-fail",
        bot_id: "b",
        event_type: "message.received",
        status: "failed",
        created_at: daysAgo(181),
      },
      {
        id: "t-open",
        bot_id: "b",
        event_id: "ticket:1",
        event_type: "ticket",
        status: "open",
        created_at: daysAgo(400),
      },
      {
        id: "t-wait",
        bot_id: "b",
        event_id: "ticket:2",
        event_type: "ticket",
        status: "waiting",
        created_at: daysAgo(400),
      },
      {
        id: "t-old",
        bot_id: "b",
        event_id: "ticket:3",
        event_type: "ticket",
        status: "pending",
        created_at: daysAgo(400),
      },
      {
        id: "t-closed",
        bot_id: "b",
        event_id: "ticket:4",
        event_type: "ticket",
        status: "closed",
        created_at: daysAgo(400),
      },
      {
        id: "refund",
        bot_id: "b",
        event_id: "order:7:refund:x",
        event_type: "order.refund",
        status: "event",
        created_at: daysAgo(400),
      },
      {
        id: "old-order-event",
        bot_id: "b",
        event_id: "order:7:placed:x",
        event_type: "order.placed",
        status: "event",
        created_at: daysAgo(400),
      },
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual([
      "t-open",
      "t-wait",
      "t-old",
      "t-closed",
      "refund",
    ]);
  });

  it("участники розыгрыша не удаляются, обычные старые события — удаляются", async () => {
    db.tables.zernio_logs = [
      {
        id: "entry",
        bot_id: "b",
        event_id: "giveaway:abcdefgh:entry:tg:1",
        event_type: "giveaway.entry",
        status: "event",
        created_at: daysAgo(400),
      },
      {
        id: "notice",
        bot_id: "b",
        event_id: "giveaway:abcdefgh:notice:prize:tg:1",
        event_type: "giveaway.notice",
        status: "sent",
        created_at: daysAgo(400),
      },
      {
        id: "old-order-event",
        bot_id: "b",
        event_id: "order:7:placed:x",
        event_type: "order.placed",
        status: "event",
        created_at: daysAgo(400),
      },
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["entry", "notice"]);
  });

  it("жалобы площадки не удаляются, отметки жалоб — удаляются как обычные события", async () => {
    db.tables.zernio_logs = [
      {
        id: "report",
        bot_id: "b",
        event_type: "market.report",
        status: "open",
        created_at: daysAgo(400),
      },
      {
        id: "report-closed",
        bot_id: "b",
        event_type: "market.report",
        status: "closed",
        created_at: daysAgo(400),
      },
      {
        id: "claim",
        bot_id: "b",
        event_type: "market.report.claim",
        status: "processed",
        created_at: daysAgo(31),
      },
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["report", "report-closed"]);
  });

  it("склад: приход, списание и инвентаризация не удаляются, остальные движения — удаляются", async () => {
    const row = (id: string, type: string) => ({
      id,
      bot_id: "b",
      event_id: `stock:${id}`,
      event_type: type,
      status: "event",
      created_at: daysAgo(400),
    });
    db.tables.zernio_logs = [
      row("receipt", "stock.receipt"),
      row("writeoff", "stock.writeoff"),
      row("stocktake", "stock.stocktake"),
      row("order", "stock.order"),
      row("edit", "stock.edit"),
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["receipt", "writeoff", "stocktake"]);
  });

  it("Д3: учёт диалога (статус, ответственный) не удаляется по возрасту строки", async () => {
    db.tables.zernio_logs = [
      {
        id: "inbox-open",
        bot_id: "b",
        event_id: "inbox:b:1",
        event_type: "inbox",
        status: "open",
        created_at: daysAgo(210),
      },
      {
        id: "inbox-closed",
        bot_id: "b",
        event_id: "inbox:b:2",
        event_type: "inbox",
        status: "closed",
        created_at: daysAgo(400),
      },
      {
        id: "old-fail",
        bot_id: "b",
        event_type: "message.received",
        status: "failed",
        created_at: daysAgo(181),
      },
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["inbox-open", "inbox-closed"]);
  });

  it("пустой круг клиентов v2 — ничего не трогает", async () => {
    db.tables.zernio_logs = [
      { id: "old-ok", bot_id: "b", status: "processed", created_at: daysAgo(31) },
    ];
    expect(await pruneZernioLogs(NOW, [])).toEqual({ deleted: 0, done: true });
    expect(db.tables.zernio_logs).toHaveLength(1);
  });
});

describe("брони задач регистрации в operator_settings", () => {
  it("удаляет только signup_challenge: старше суток, остальные строки общей с v1 таблицы не трогает", async () => {
    const past = new Date(NOW - 1000).toISOString();
    const future = new Date(NOW + 3600_000).toISOString();
    db.tables.operator_settings = [
      { key: "signup_challenge:old1", value: past },
      { key: "signup_challenge:old2", value: daysAgo(10) },
      { key: "signup_challenge:fresh", value: future },
      // «_» в LIKE — любой символ: похожий ключ не должен попасть под удаление.
      { key: "signupXchallenge:old", value: past },
      { key: "operator_password_hash", value: past },
      { key: "session_revoked:x", value: past },
      { key: "signup_challenge:not-a-date", value: "abc" },
    ];
    expect(await pruneSignupChallenges(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.operator_settings!.map((r) => r.key)).toEqual([
      "signup_challenge:fresh",
      "signupXchallenge:old",
      "operator_password_hash",
      "session_revoked:x",
      "signup_challenge:not-a-date",
    ]);
  });

  it("полная порция, где всё отсеяно сверкой, — конец уборки, а не бесконечный круг", async () => {
    db.tables.operator_settings = Array.from({ length: BATCH }, (_, i) => ({
      key: `signupXchallenge:${i}`,
      value: new Date(NOW - 1000).toISOString(),
    }));
    expect(await pruneSignupChallenges(NOW)).toEqual({ deleted: 0, done: true });
    expect(db.tables.operator_settings).toHaveLength(BATCH);
  });
});

describe("счётчики автопроверок чека покупателей", () => {
  const counter = (day: string) => JSON.stringify({ day, n: 1, order_id: 5, order_n: 1 });
  /** Строка счётчика, как её пишет updateSettingAtomic: дата записи = день счётчика. */
  const row = (bot_id: string, key: string, daysOld: number, value?: string) => ({
    bot_id,
    key,
    value: value ?? counter(daysAgo(daysOld).slice(0, 10)),
    updated_at: daysAgo(daysOld),
  });
  const OLD = RETENTION.receiptChecksDays + 1;

  it("pruneReceiptChecks удаляет строки receipt_checks: со старым днём, строго по префиксу", async () => {
    db.tables.app_settings = [
      row("bot-1", "receipt_checks:tg_1", OLD),
      row("bot-1", "receipt_checks:tg_2", 1),
      row("bot-2", "receipt_checks:tg_1", OLD),
      // Не счётчики: чужой префикс, «_» в LIKE, битое значение, настройка магазина.
      row("bot-1", "receiptXchecks:tg_3", OLD),
      row("bot-1", "receipt_checks_total", OLD),
      row("bot-1", "receipt_checks:tg_4", OLD, "abc"),
      row("bot-1", "receipt_ocr_usage", OLD, '{"count":5}'),
    ];
    expect(await pruneReceiptChecks(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.app_settings!.map((r) => `${r.bot_id} ${r.key}`)).toEqual([
      "bot-1 receipt_checks:tg_2",
      "bot-1 receiptXchecks:tg_3",
      "bot-1 receipt_checks_total",
      "bot-1 receipt_checks:tg_4",
      "bot-1 receipt_ocr_usage",
    ]);
  });

  it("больше порции свежих счётчиков не заслоняют старые", async () => {
    db.tables.app_settings = [
      ...Array.from({ length: BATCH + 5 }, (_, i) => row("bot-1", `receipt_checks:tg_f${i}`, 1)),
      row("bot-1", "receipt_checks:tg_old", OLD),
    ];
    expect(await pruneReceiptChecks(NOW)).toEqual({ deleted: 1, done: true });
    expect(db.tables.app_settings!.some((r) => r.key === "receipt_checks:tg_old")).toBe(false);
    expect(db.tables.app_settings).toHaveLength(BATCH + 5);
  });

  it("только клиенты из границ прохода (v2)", async () => {
    db.tables.app_settings = [
      row("bot-1", "receipt_checks:tg_1", OLD),
      row("bot-v1", "receipt_checks:tg_1", OLD),
    ];
    expect(await pruneReceiptChecks(NOW, ["bot-1"])).toEqual({ deleted: 1, done: true });
    expect(db.tables.app_settings!.map((r) => r.bot_id)).toEqual(["bot-v1"]);
    expect(await pruneReceiptChecks(NOW, [])).toEqual({ deleted: 0, done: true });
  });
});

describe("общие счётчики лимита частоты", () => {
  const counter = (daysOld: number) =>
    JSON.stringify({ w: NOW - daysOld * 86_400_000, c: 3, p: 1 });
  const row = (bot_id: string, key: string, daysOld: number, value?: string) => ({
    bot_id,
    key,
    value: value ?? counter(daysOld),
    updated_at: daysAgo(daysOld),
  });
  const OLD = RETENTION.rateLimitDays + 1;

  it("pruneRateLimits удаляет только старые счётчики rate_limit:, остальное не трогает", async () => {
    db.tables.app_settings = [
      row("bot-1", "rate_limit:mini_app_checkout:tg_1", OLD),
      row("bot-1", "rate_limit:course:item-1", OLD),
      row("bot-1", "rate_limit:mini_app_orders:tg_2", 0),
      // Не наши строки: «_» в LIKE, похожие имена, настройка магазина, битое значение.
      row("bot-1", "rateXlimit:k:tg_1", OLD),
      row("bot-1", "rate_limits_note", OLD),
      row("bot-1", "shop_name", OLD, "Магазин"),
      row("bot-1", "receipt_checks:tg_1", OLD),
      row("bot-1", "rate_limit:k:broken", OLD, "abc"),
    ];
    expect(await pruneRateLimits(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.app_settings!.map((r) => r.key)).toEqual([
      "rate_limit:mini_app_orders:tg_2",
      "rateXlimit:k:tg_1",
      "rate_limits_note",
      "shop_name",
      "receipt_checks:tg_1",
      "rate_limit:k:broken",
    ]);
  });

  it("свежее окно в старой строке не удаляется", async () => {
    // Дата записи отстала, а окно свежее (часы разошлись) — строку оставляем.
    db.tables.app_settings = [row("bot-1", "rate_limit:k:tg_1", OLD, counter(0))];
    expect(await pruneRateLimits(NOW)).toEqual({ deleted: 0, done: true });
    expect(db.tables.app_settings).toHaveLength(1);
  });

  it("больше порции свежих счётчиков не заслоняют старые", async () => {
    db.tables.app_settings = [
      ...Array.from({ length: BATCH + 5 }, (_, i) => row("bot-1", `rate_limit:k:tg_f${i}`, 0)),
      row("bot-1", "rate_limit:k:tg_old", OLD),
    ];
    expect(await pruneRateLimits(NOW)).toEqual({ deleted: 1, done: true });
    expect(db.tables.app_settings).toHaveLength(BATCH + 5);
  });

  it("только клиенты из границ прохода (v2)", async () => {
    db.tables.app_settings = [
      row("bot-1", "rate_limit:k:tg_1", OLD),
      row("bot-v1", "rate_limit:k:tg_1", OLD),
    ];
    expect(await pruneRateLimits(NOW, ["bot-1"])).toEqual({ deleted: 1, done: true });
    expect(db.tables.app_settings!.map((r) => r.bot_id)).toEqual(["bot-v1"]);
    expect(await pruneRateLimits(NOW, [])).toEqual({ deleted: 0, done: true });
  });
});

describe("закрытые заявки воронки сделок", () => {
  const lead = (id: string, stage: string, closedDaysAgo: number | null, createdDaysAgo = 200) =>
    JSON.stringify({
      id,
      stage,
      name: "Анна",
      contact: "1",
      source: "manual",
      created_at: daysAgo(createdDaysAgo),
      updated_at: daysAgo(closedDaysAgo ?? createdDaysAgo),
      closed_at: closedDaysAgo == null ? null : daysAgo(closedDaysAgo),
    });
  const row = (bot_id: string, key: string, value: string, updatedDaysAgo: number) => ({
    bot_id,
    key,
    value,
    updated_at: daysAgo(updatedDaysAgo),
  });
  const OLD = RETENTION.closedLeadsDays + 1;

  it("pruneClosedLeads удаляет закрытые раньше окна, открытые и свежие остаются", async () => {
    db.tables.app_settings = [
      row("bot-1", "crm:lead:a", lead("a", "lost", OLD), OLD),
      row("bot-1", "crm:lead:b", lead("b", "won", OLD), OLD),
      row("bot-1", "crm:lead:c", lead("c", "lost", 3), 3),
      // Открытая, хоть и старая: продавец ещё работает с ней.
      row("bot-1", "crm:lead:d", lead("d", "in_progress", null), OLD + 100),
      // Не заявки: чужой префикс, «_» не при чём, битое значение.
      row("bot-1", "crmXlead:e", lead("e", "lost", OLD), OLD),
      row("bot-1", "crm:lead:f", "abc", OLD),
      row("bot-1", "crm_webhook", "{}", OLD),
    ];
    expect(await pruneClosedLeads(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.app_settings!.map((r) => r.key)).toEqual([
      "crm:lead:c",
      "crm:lead:d",
      "crmXlead:e",
      "crm:lead:f",
      "crm_webhook",
    ]);
  });

  it("только клиенты из границ прохода (v2)", async () => {
    db.tables.app_settings = [
      row("bot-1", "crm:lead:a", lead("a", "lost", OLD), OLD),
      row("bot-v1", "crm:lead:a", lead("a", "lost", OLD), OLD),
    ];
    expect(await pruneClosedLeads(NOW, ["bot-1"])).toEqual({ deleted: 1, done: true });
    expect(db.tables.app_settings!.map((r) => r.bot_id)).toEqual(["bot-v1"]);
  });
});

describe("брони задач оформления на витрине", () => {
  const row = (bot_id: string, key: string, daysOld: number) => ({
    bot_id,
    key,
    value: daysAgo(daysOld),
    updated_at: daysAgo(daysOld),
  });

  it("удаляет брони старше суток, строго по префиксу и только у клиентов v2", async () => {
    db.tables.app_settings = [
      row("bot-1", "checkout_challenge:aaa", 2),
      row("bot-1", "checkout_challenge:bbb", 0.5),
      row("bot-2", "checkout_challenge:ccc", 2),
      row("bot-1", "checkoutXchallenge:ddd", 2),
      row("bot-1", "storefront_checkout", 2),
    ];
    expect(await pruneCheckoutChallenges(NOW, ["bot-1"])).toEqual({ deleted: 1, done: true });
    expect(db.tables.app_settings!.map((r) => `${r.bot_id} ${r.key}`)).toEqual([
      "bot-1 checkout_challenge:bbb",
      "bot-2 checkout_challenge:ccc",
      "bot-1 checkoutXchallenge:ddd",
      "bot-1 storefront_checkout",
    ]);
  });
});

describe("ночная уборка без явных границ — только клиенты v2 (переезд)", () => {
  it("журналы и счётчики клиента v1 и клиента без served_by не трогаются", async () => {
    directory = [
      { id: "bot-v2", settings: { served_by: "v2" } },
      { id: "bot-v1", settings: { served_by: "v1" } },
      { id: "bot-none", settings: {} },
    ];
    const old = RETENTION.zernioLogsDays + 5;
    const bots = ["bot-v2", "bot-v1", "bot-none"];
    db.tables.zernio_logs = bots.map((b) => ({
      id: `z-${b}`,
      bot_id: b,
      status: "processed",
      created_at: daysAgo(old),
    }));
    const day = daysAgo(RETENTION.receiptChecksDays + 5);
    db.tables.app_settings = bots.map((b) => ({
      bot_id: b,
      key: "receipt_checks:tg_1",
      value: JSON.stringify({ day: day.slice(0, 10), n: 1, order_id: 1, order_n: 1 }),
      updated_at: day,
    }));
    const out = await runRetention(NOW, 5_000);
    expect(out.zernio_logs).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((r) => r.bot_id)).toEqual(["bot-v1", "bot-none"]);
    expect(db.tables.app_settings.map((r) => r.bot_id)).toEqual(["bot-v1", "bot-none"]);
  });
});

describe("уборка при сотнях клиентов: `.in` кусками (Б29)", () => {
  it("450 клиентов и 450 рассылок — ни один запрос не длиннее 200 значений, всё убрано", async () => {
    db = fakeDb({ maxIn: 200 });
    const ids = Array.from({ length: 450 }, (_, i) => `bot-${i}`);
    directory = ids.map((id) => ({ id, settings: { served_by: "v2" } }));
    const old = RETENTION.zernioLogsDays + 5;
    db.tables.zernio_logs = ids.map((b) => ({
      id: `z-${b}`,
      bot_id: b,
      status: "processed",
      created_at: daysAgo(old),
    }));
    db.tables.broadcasts = ids.map((b, i) => ({
      id: `br-${i}`,
      bot_id: b,
      created_at: daysAgo(RETENTION.broadcastRecipientsDays + 5),
    }));
    db.tables.broadcast_recipients = ids.map((_, i) => ({
      id: `r-${i}`,
      broadcast_id: `br-${i}`,
      status: "sent",
    }));
    const out = await runRetention(NOW, 5_000);
    expect(out.zernio_logs).toEqual({ deleted: 450, done: true });
    expect(out.broadcast_recipients).toEqual({ deleted: 450, done: true });
    expect(db.tables.zernio_logs).toHaveLength(0);
    expect(db.tables.broadcast_recipients).toHaveLength(0);
  });
});

describe("жалобы и события площадки (Л2)", () => {
  const report = (id: string, status: string, resolvedDaysAgo: number | null, bot = "b") => ({
    id,
    bot_id: bot,
    event_type: "market.report",
    status,
    created_at: daysAgo(900),
    payload: resolvedDaysAgo === null ? {} : { resolved_at: daysAgo(resolvedDaysAgo) },
  });

  it("жалоба остаётся: открытая — в любом возрасте, закрытая — год после решения; старые закрытые уходят", async () => {
    const year = RETENTION.marketReportClosedDays;
    db.tables.zernio_logs = [
      report("open-old", "open", null),
      report("closed-recent", "closed", 10),
      report("closed-edge", "closed", year - 1),
      report("closed-no-time", "closed", null),
      report("closed-old", "closed", year + 1),
      report("closed-older", "closed", year + 200),
      // Не жалоба: тот же возраст решения у чужого события не делает его целью.
      {
        id: "other",
        bot_id: "b",
        event_type: "ticket",
        status: "closed",
        created_at: daysAgo(900),
        payload: { resolved_at: daysAgo(900) },
      },
    ];
    expect(await pruneClosedMarketReports(NOW)).toEqual({ deleted: 2, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual([
      "open-old",
      "closed-recent",
      "closed-edge",
      "closed-no-time",
      "other",
    ]);
  });

  it("границы клиентов: жалобы клиента вне списка (прежняя платформа) не трогаются", async () => {
    db.tables.zernio_logs = [
      report("mine", "closed", 400, "b1"),
      report("theirs", "closed", 400, "b2"),
    ];
    expect(await pruneClosedMarketReports(NOW, ["b1"])).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual(["theirs"]);
    expect(await pruneClosedMarketReports(NOW, [])).toEqual({ deleted: 0, done: true });
  });

  it("ошибка чтения жалоб — ошибка, а не «удалять нечего»", async () => {
    const { withBrokenReads } = await import("../../../tests/broken-db");
    db = withBrokenReads(fakeDb(), ["zernio_logs"]);
    await expect(pruneClosedMarketReports(NOW)).rejects.toThrow();
  });

  it("события площадки старше keepDays уходят порциями BATCH, свежие остаются", async () => {
    const { MARKET_STATS } = await import("@/core/marketplace/analytics");
    const old = Array.from({ length: BATCH + 50 }, (_, i) => ({
      id: `old-${String(i).padStart(5, "0")}`,
      kind: "visit",
      created_at: daysAgo(MARKET_STATS.keepDays + 1),
    }));
    db.tables.market_events = [...old, { id: "fresh", kind: "visit", created_at: daysAgo(1) }];
    expect(await pruneMarketEvents(NOW)).toEqual({ deleted: BATCH, done: false });
    expect(await pruneMarketEvents(NOW)).toEqual({ deleted: 50, done: true });
    expect(db.tables.market_events.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("таблицы событий нет (миграция не применена) — чистить нечего, ошибки нет", async () => {
    const chain: unknown = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "then"
            ? (ok: (v: unknown) => unknown) =>
                Promise.resolve({
                  data: null,
                  error: {
                    code: "PGRST205",
                    message: "Could not find the table 'public.market_events'",
                  },
                }).then(ok)
            : () => chain,
      },
    );
    db = { from: () => chain } as unknown as FakeDb;
    expect(await pruneMarketEvents(NOW)).toEqual({ deleted: 0, done: true });
  });

  it("runRetention чистит и жалобы, и события площадки в общем проходе", async () => {
    const { MARKET_STATS } = await import("@/core/marketplace/analytics");
    directory = [{ id: "b", settings: { served_by: "v2" } }];
    db.tables.zernio_logs = [report("closed-old", "closed", 500), report("open", "open", null)];
    db.tables.market_events = [
      { id: "e1", kind: "visit", created_at: daysAgo(MARKET_STATS.keepDays + 5) },
    ];
    const r = await runRetention(NOW);
    expect(r.market_reports_closed).toEqual({ deleted: 1, done: true });
    expect(r.market_events).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((x) => x.id)).toEqual(["open"]);
  });
});

describe("объём жалобы площадки (Л2)", () => {
  it("строка жалобы с полями на потолках — не больше 4 КБ (кириллица — 2 байта на знак): форма не раздувает zernio_logs", async () => {
    const { REPORT_TEXT_MAX, cleanReport } = await import("@/core/marketplace/report");
    const cleaned = cleanReport({
      reason: "other",
      text: "я".repeat(REPORT_TEXT_MAX * 3),
      slug: "s".repeat(500),
      productId: "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12),
    });
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    // Как пишет submitReport: названия обрезаются до 200, остальное — из cleanReport.
    const row = {
      slug: cleaned.value.slug,
      shop: "м".repeat(200),
      product_id: cleaned.value.productId,
      product: "т".repeat(200),
      reason: cleaned.value.reason,
      text: cleaned.value.text,
      reporter: "a".repeat(16),
    };
    expect(new TextEncoder().encode(JSON.stringify(row)).length).toBeLessThan(4096);
    expect(cleaned.value.text.length).toBe(REPORT_TEXT_MAX);
    expect(cleaned.value.slug.length).toBe(80);
  });
});

describe("упавшее чтение перед удалением (Т3)", () => {
  /** Чтения (select) падают, удаления и записи идут в настоящий fakeDb: видно, что удалено. */
  function readsFail(real: FakeDb): FakeDb {
    const failing = (): unknown => {
      const result = { data: null, error: { message: "connection reset" }, count: null };
      return new Proxy(
        {},
        {
          get: (_t, key) =>
            key === "then"
              ? (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
              : () => failing(),
        },
      );
    };
    return new Proxy(real, {
      get: (target, key) => {
        if (key !== "from") return (target as unknown as Record<string | symbol, unknown>)[key];
        return (table: string) =>
          new Proxy(target.from(table) as unknown as Record<string | symbol, unknown>, {
            get: (q, k) => (k === "select" ? () => failing() : q[k]),
          });
      },
    });
  }

  const old = daysAgo(4000);
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ["pruneZernioLogs", () => pruneZernioLogs(NOW)],
    ["pruneMarketEvents", () => pruneMarketEvents(NOW)],
    ["pruneClosedMarketReports", () => pruneClosedMarketReports(NOW)],
    ["pruneSignupChallenges", () => pruneSignupChallenges(NOW)],
    ["pruneReceiptChecks", () => pruneReceiptChecks(NOW)],
    ["pruneRateLimits", () => pruneRateLimits(NOW)],
    ["pruneClosedLeads", () => pruneClosedLeads(NOW)],
    ["pruneBroadcastRecipients", () => pruneBroadcastRecipients(NOW)],
    ["pruneCheckoutChallenges", () => pruneCheckoutChallenges(NOW)],
  ];

  for (const [name, run] of jobs)
    it(`${name}: чтение упало — ошибка, ни одна строка не удалена`, async () => {
      const real = fakeDb();
      real.tables.zernio_logs = [
        { id: "z1", event_type: "webhook", status: "processed", created_at: old },
        { id: "z2", event_type: "market.report", status: "closed", created_at: old },
      ];
      real.tables.market_events = [{ id: "m1", kind: "visit", created_at: old }];
      real.tables.operator_settings = [{ key: "signup_challenge:x", value: old, updated_at: old }];
      real.tables.app_settings = [
        { bot_id: "b", key: "rate_limit:x", value: old, updated_at: old },
        { bot_id: "b", key: "receipt_check:x", value: old, updated_at: old },
        { bot_id: "b", key: "checkout_challenge:x", value: old, updated_at: old },
      ];
      real.tables.broadcasts = [{ id: "bc1", bot_id: "b", created_at: old }];
      real.tables.broadcast_recipients = [{ id: "r1", broadcast_id: "bc1" }];
      real.tables.manager_chat_messages = [{ id: "c1", created_at: old }];
      const before = JSON.stringify(real.tables);
      db = readsFail(real);
      await expect(run()).rejects.toBeInstanceOf(ServerFailure);
      expect(JSON.stringify(real.tables)).toBe(before);
    });
});
