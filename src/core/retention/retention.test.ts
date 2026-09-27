import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const {
  RETENTION,
  pruneBroadcastRecipients,
  pruneCheckoutChallenges,
  pruneClosedLeads,
  pruneOperatorLoginAttempts,
  pruneReceiptChecks,
  pruneRateLimits,
  BATCH,
  pruneSignupChallenges,
  pruneZernioLogs,
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
    ];
    expect(await pruneZernioLogs(NOW)).toEqual({ deleted: 1, done: true });
    expect(db.tables.zernio_logs.map((r) => r.id)).toEqual([
      "t-open",
      "t-wait",
      "t-old",
      "t-closed",
    ]);
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
