import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../../tests/fake-db";
import type { Tenant } from "@/core/tenant/types";

/** Напоминания о конце пробного периода: один раз, без гонки, только v2, текст = политика. */
let db: FakeDb;
vi.mock("@/core/db/client.server", () => ({ serviceDb: () => db }));
vi.mock("@/core/tenant/resolve.server", () => ({
  tenantContext: (t: Tenant) => ({ db, tenant: t, timezone: "Asia/Almaty" }),
}));
let owner: () => Promise<{
  delivered: string[];
  failed: { id: string; reason: string }[];
}> = async () => ({ delivered: [], failed: [] });
vi.mock("./operator.server", () => ({ notifyOwner: () => owner() }));

const { remindTrials, TRIAL_REMINDED_KEY } = await import("./trial-remind.server");

const BOT = "00000000-0000-0000-0000-0000000000b1";
// 11:00 в Алматы 6 октября: до 9 октября осталось 3 дня.
const NOW = new Date("2026-10-06T06:00:00Z");

function tenant(over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  return {
    id: BOT,
    name: "Демо",
    status: "active",
    archived: false,
    settings: { served_by: "v2", billing: { trial_until: "2026-10-09" }, ...settings },
    ...over,
  } as unknown as Tenant;
}
let sent: string[] = [];
const notify = async (_id: string, text: string) => {
  sent.push(text);
  return true;
};
const marks = () =>
  (db.tables.app_settings ?? []).find((r) => r.key === TRIAL_REMINDED_KEY)?.value as
    string | undefined;

beforeEach(() => {
  db = fakeDb({ unique: { app_settings: [["bot_id", "key"]] } });
  db.tables.app_settings = [];
  db.tables.bots = [{ id: BOT, subscription_expires_at: "2026-10-09T00:00:00Z" }];
  sent = [];
});

describe("напоминания о пробном периоде", () => {
  it("за 3 дня — одно сообщение, повторный прогон не дублирует", async () => {
    const t = tenant();
    expect(await remindTrials([t], NOW, notify)).toEqual({ [BOT]: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("09.10");
    expect(sent[0]).toContain("«Модули»");
    expect(marks()).toBe("d3");
    expect(await remindTrials([t], NOW, notify)).toEqual({});
    expect(sent).toHaveLength(1);
  });

  it("в последний день — ещё одно, и больше ничего", async () => {
    const t = tenant();
    await remindTrials([t], NOW, notify);
    const last = new Date("2026-10-09T06:00:00Z");
    expect(await remindTrials([t], last, notify)).toEqual({ [BOT]: "sent" });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("последний день");
    expect(marks()).toBe("d3,last");
    await remindTrials([t], last, notify);
    expect(sent).toHaveLength(2);
  });

  it("два крона одновременно — одно сообщение", async () => {
    const t = tenant();
    const r = await Promise.all([remindTrials([t], NOW, notify), remindTrials([t], NOW, notify)]);
    expect(sent).toHaveLength(1);
    const outcomes = r.flatMap((x) => Object.values(x));
    expect(outcomes).toContain("sent");
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
  });

  it("не доставилось — метка снята, следующий прогон повторит", async () => {
    const t = tenant();
    expect(await remindTrials([t], NOW, async () => false)).toEqual({ [BOT]: "failed" });
    expect(marks()).toBe("");
    expect(await remindTrials([t], NOW, notify)).toEqual({ [BOT]: "sent" });
    expect(sent).toHaveLength(1);
  });

  it("клиент прежней платформы, архивный, приостановленный — ничего", async () => {
    for (const t of [
      tenant({}, { served_by: "v1" }),
      tenant({ archived: true }),
      tenant({ status: "suspended" }),
    ])
      expect(await remindTrials([t], NOW, notify)).toEqual({});
    expect(sent).toEqual([]);
  });

  it("оплатил до конца пробного — напоминать нечего", async () => {
    db.tables.bots = [{ id: BOT, subscription_expires_at: "2026-11-08T00:00:00Z" }];
    expect(await remindTrials([tenant()], NOW, notify)).toEqual({});
    expect(sent).toEqual([]);
  });

  it("раньше чем за 3 дня и после конца — тихо", async () => {
    expect(await remindTrials([tenant()], new Date("2026-10-05T06:00:00Z"), notify)).toEqual({});
    expect(await remindTrials([tenant()], new Date("2026-10-10T06:00:00Z"), notify)).toEqual({});
    expect(sent).toEqual([]);
  });

  it("текст повторяет политику неоплаты клиента", async () => {
    await remindTrials([tenant()], NOW, notify);
    expect(sent[0]).toContain("продолжит работать");
    expect(sent[0]).not.toContain("приостановлен");
    db.tables.app_settings = [];
    sent = [];
    await remindTrials([tenant({}, { on_overdue: "suspend", grace_days: 2 })], NOW, notify);
    expect(sent[0]).toContain("приостановлен после отсрочки в 2 дн.");
  });

  it("день берётся по часовому поясу магазина", async () => {
    // 20:00 UTC 5 октября — в Алматы уже 6-е: до 9-го 3 дня; по UTC было бы 4.
    expect(await remindTrials([tenant()], new Date("2026-10-05T20:00:00Z"), notify)).toEqual({
      [BOT]: "sent",
    });
  });

  it("О4: отправка оборвалась или не ответил Telegram — метка остаётся, второго сообщения нет", async () => {
    const t = tenant();
    owner = async () => {
      throw new Error("fetch failed");
    };
    expect(await remindTrials([t], NOW)).toEqual({ [BOT]: "unknown" });
    expect(marks()).toBe("d3");
    owner = async () => ({
      delivered: [],
      failed: [{ id: "1", reason: "Telegram не ответил, попробуйте позже" }],
    });
    expect(await remindTrials([t], NOW)).toEqual({});
    expect(marks()).toBe("d3");
  });

  it("О4: Telegram точно отказал (бот заблокирован) — метка снята, завтра повторим", async () => {
    const t = tenant();
    owner = async () => ({
      delivered: [],
      failed: [{ id: "1", reason: "заблокировал бота (Forbidden: bot was blocked by the user)" }],
    });
    expect(await remindTrials([t], NOW)).toEqual({ [BOT]: "failed" });
    expect(marks()).toBe("");
    owner = async () => ({ delivered: ["1"], failed: [] });
    expect(await remindTrials([t], NOW)).toEqual({ [BOT]: "sent" });
  });
});
