import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";

let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));

const {
  RETENTION,
  pruneBroadcastRecipients,
  pruneOperatorLoginAttempts,
  pruneReceiptChecks,
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
